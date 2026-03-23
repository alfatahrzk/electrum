import streamlit as st
import pandas as pd
import math
import folium
from supabase import create_client, Client
from streamlit_geolocation import streamlit_geolocation
from PIL import Image
from pyzbar.pyzbar import decode
from streamlit_folium import st_folium

# --- 1. DATABASE MANAGER ---
class DatabaseManager:
    def __init__(self, url, key):
        self.client: Client = create_client(url, key)

    def save_bss(self, name, lat, long):
        data = {"nama_bss": name, "lat": lat, "long": long}
        return self.client.table("bss_locations").insert(data).execute()

    def get_all_bss(self):
        res = self.client.table("bss_locations").select("*").execute()
        return pd.DataFrame(res.data)

    def save_log(self, log_data):
        return self.client.table("battery_logs").insert(log_data).execute()

    def get_logs(self):
        # Join untuk mendapatkan nama BSS di tabel log
        res = self.client.table("battery_logs").select("*, bss_locations(nama_bss)").execute()
        return pd.DataFrame(res.data)

# --- 2. LOCATION SERVICE ---
class LocationService:
    @staticmethod
    def calculate_distance(lat1, lon1, lat2, lon2):
        R = 6371000 # Meter
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    def find_nearest_bss(self, user_lat, user_long, bss_df, radius=50):
        if bss_df.empty: return None
        for _, bss in bss_df.iterrows():
            dist = self.calculate_distance(user_lat, user_long, bss['lat'], bss['long'])
            if dist <= radius:
                return bss
        return None

# --- 3. MAIN APP CLASS ---
class BatteryApp:
    def __init__(self, db_manager):
        self.db = db_manager
        self.loc_service = LocationService()
        # Default Surabaya
        self.default_lat = -7.287
        self.default_lon = 112.74

    def run(self):
        st.sidebar.title("🔋 Electrum Tracker")
        menu = ["Input Data", "Registrasi BSS", "Dashboard Analisis"]
        choice = st.sidebar.selectbox("Pilih Fitur", menu)

        if choice == "Input Data":
            self.render_input_page()
        elif choice == "Registrasi BSS":
            self.render_bss_registration()
        elif choice == "Dashboard Analisis":
            self.render_analytics()

    def render_map(self, bss_df, user_lat=None, user_lon=None, key="map"):
        """Fungsi peta reusable"""
        center_lat = user_lat if user_lat else self.default_lat
        center_lon = user_lon if user_lon else self.default_lon
        
        m = folium.Map(location=[center_lat, center_lon], zoom_start=15)
        
        if not bss_df.empty:
            for _, bss in bss_df.iterrows():
                folium.Marker(
                    [bss['lat'], bss['long']],
                    popup=f"BSS: {bss['nama_bss']}",
                    icon=folium.Icon(color="green", icon="bolt", prefix="fa")
                ).add_to(m)
                folium.Circle(
                    location=[bss['lat'], bss['long']],
                    radius=50, color="green", fill=True, fill_opacity=0.1
                ).add_to(m)

        if user_lat and user_lon:
            folium.Marker(
                [user_lat, user_lon],
                popup="Posisi Anda",
                icon=folium.Icon(color="blue", icon="user", prefix="fa")
            ).add_to(m)

        st_folium(m, width="100%", height=400, key=key)

    def render_input_page(self):
        st.subheader("📲 Log Penggunaan Baterai")
        location = streamlit_geolocation()
        u_lat = location.get('latitude') or self.default_lat
        u_lon = location.get('longitude') or self.default_lon
        
        st.write(f"📍 Lokasi Terdeteksi: `{u_lat}, {u_lon}`")

        bss_df = self.db.get_all_bss()
        nearest = self.loc_service.find_nearest_bss(u_lat, u_lon, bss_df)
        
        id_bss = None
        if nearest is not None:
            st.info(f"✅ Terkunci di BSS: **{nearest['nama_bss']}**")
            id_bss = nearest['id']
        else:
            st.warning("⚠️ Anda di luar radius 50m dari BSS mana pun.")

        img_file = st.camera_input("Ambil Foto QR Baterai")
        id_baterai = ""
        if img_file:
            img = Image.open(img_file)
            decoded = decode(img)
            if decoded:
                id_baterai = decoded[0].data.decode("utf-8")
                st.success(f"ID Baterai Terdeteksi: **{id_baterai}**")
            else:
                st.error("Gagal membaca QR. Pastikan cahaya cukup.")

        persentase = st.slider("Kapasitas Baterai (%)", 1, 100, 50)

        if st.button("🚀 Simpan Log"):
            if id_baterai:
                log_data = {
                    "id_baterai": id_baterai,
                    "lat": u_lat, "long": u_lon,
                    "persentase_tenaga": persentase,
                    "id_bss": id_bss
                }
                self.db.save_log(log_data)
                st.balloons()
                st.success("Data berhasil disimpan!")
            else:
                st.error("QR Code wajib di-scan.")

    def render_bss_registration(self):
        st.subheader("📍 Registrasi BSS Baru")
        existing_bss_df = self.db.get_all_bss()
        
        if 'selected_bss_coords' not in st.session_state:
            st.session_state.selected_bss_coords = None

        location = streamlit_geolocation()
        u_lat = location.get('latitude') or self.default_lat
        u_lon = location.get('longitude') or self.default_lon

        m = folium.Map(location=[u_lat, u_lon], zoom_start=16)

        # Marker Hijau (Eksisting)
        for _, bss in existing_bss_df.iterrows():
            folium.Marker([bss['lat'], bss['long']], icon=folium.Icon(color="green")).add_to(m)

        # Marker Merah (Koreksi Klik)
        if st.session_state.selected_bss_coords:
            folium.Marker(st.session_state.selected_bss_coords, icon=folium.Icon(color="red")).add_to(m)

        map_output = st_folium(m, width="100%", height=400, key="map_reg")

        if map_output.get("last_clicked"):
            st.session_state.selected_bss_coords = (map_output["last_clicked"]["lat"], map_output["last_clicked"]["lng"])
            st.rerun()

        with st.form("form_bss"):
            nama = st.text_input("Nama BSS")
            if st.form_submit_button("✅ Daftarkan Lokasi"):
                if nama and st.session_state.selected_bss_coords:
                    self.db.save_bss(nama, st.session_state.selected_bss_coords[0], st.session_state.selected_bss_coords[1])
                    st.success("BSS Berhasil ditambahkan!")
                    st.session_state.selected_bss_coords = None
                    st.rerun()

    def render_analytics(self):
        st.subheader("📊 Analisis Data")
        logs_df = self.db.get_logs()
        bss_df = self.db.get_all_bss()

        if logs_df.empty:
            st.info("Belum ada data log.")
            return

        logs_df['timestamp'] = pd.to_datetime(logs_df['timestamp'])
        
        # Metrik
        c1, c2, c3 = st.columns(3)
        c1.metric("Total BSS", len(bss_df))
        c2.metric("Total Scan", len(logs_df))
        c3.metric("Rerata Power", f"{logs_df['persentase_tenaga'].mean():.1f}%")

        # Grafik
        st.line_chart(logs_df.set_index('timestamp')['persentase_tenaga'])
        
        # Peta
        self.render_map(bss_df, key="map_analytics")
        
        st.dataframe(logs_df.sort_values('timestamp', ascending=False))

# --- EXECUTION ---
if __name__ == "__main__":
    try:
        url = st.secrets["SUPABASE_URL"]
        key = st.secrets["SUPABASE_KEY"]
        app = BatteryApp(DatabaseManager(url, key))
        app.run()
    except Exception as e:
        st.error(f"Sistem Error: {e}")