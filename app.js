// --- SERVICES ---
        class SupabaseService {
            constructor() { 
                this.client = supabaseClient; 
            }

            async logout() { return await this.client.auth.signOut(); }
            async getSession() { return await this.client.auth.getSession(); }

            async fetchBSS() {
                const { data } = await this.client.from('bss_locations').select('*');
                return data || [];
            }
            async saveBSS(data) { return await this.client.from('bss_locations').insert([data]); }
            
            async updateBSS(id, data) { return await this.client.from('bss_locations').update(data).eq('id', id); }
            async deleteBSS(id) { return await this.client.from('bss_locations').delete().eq('id', id); }
            
            async saveLog(logData) { 
                return await this.client.from('battery_logs').insert([logData]); 
            }

            async fetchBatteries() {
                const { data, error } = await this.client.from('battery_logs')
                                    .select('id_baterai, timestamp')
                                    .order('timestamp', { ascending: false });
                
                if (error) {
                    console.error("Error narik data:", error);
                    return [];
                }
                if (!data) return [];

                // Filter ID unik
                const uniqueBatteries = [];
                const seenIds = new Set();
                
                for (const log of data) {
                    if (!seenIds.has(log.id_baterai)) {
                        seenIds.add(log.id_baterai);
                        uniqueBatteries.push(log); 
                    }
                }
                return uniqueBatteries;
            }
        }

        // --- MAIN APP CONTROLLER ---
        class ElectrumApp {
            constructor() {
                mapboxgl.accessToken = CONFIG.MAPBOX_KEY; 
                this.db = new SupabaseService();
                
                this.scanner = new Html5Qrcode("reader");
                this.batteryId = null;
                this.bssList = [];
                
                this.currentUser = null;
                this.userRole = 'public'; 
                this.predictMode = 'eco'; 

                // [FIX] Tambahkan state untuk Peta Admin di sini
                this.selectedRegCoords = null;
                this.regMarker = null;
                this.editingBssId = null;

                this.init();
            }

            async init() {
                await this.checkAuthStatus();
                this.initScanner();
                this.initListeners();
                
                if(this.userRole === 'admin') {
                    this.bssList = await this.db.fetchBSS();
                    this.initAdminMap();
                    this.loadBatteryTable();
                    this.renderBssDropdown(); // 👈 INI YANG KETINGGALAN BOSS!
                }
                
                this.switchTab('log');
            }

            async checkAuthStatus() {
                const { data: { session } } = await this.db.getSession();
                if (session) {
                    this.currentUser = session.user;
                    
                    const userEmail = this.currentUser.email;
                    this.userRole = userEmail.includes('@electrum-admin.com') ? 'admin' : 'user';
                    
                    const displayUsername = userEmail.split('@')[0];
                    
                    document.getElementById('txt-role-badge').innerText = `${displayUsername.toUpperCase()} (${this.userRole.toUpperCase()})`;
                    document.getElementById('txt-role-badge').className = this.userRole === 'admin' 
                        ? "text-[10px] font-bold text-emerald-400 bg-emerald-900/50 px-2 py-0.5 rounded-full inline-block mt-1" 
                        : "text-[10px] font-bold text-blue-400 bg-blue-900/50 px-2 py-0.5 rounded-full inline-block mt-1";
                        
                    document.getElementById('btn-show-login').classList.add('hidden');
                    document.getElementById('btn-logout').classList.remove('hidden');
                    
                    if(this.userRole === 'admin') {
                        document.getElementById('tab-admin-bss').classList.remove('hidden');
                        document.getElementById('tab-admin-bat').classList.remove('hidden');
                    }
                }
            }

            initAdminMap() {
                this.mapReg = new mapboxgl.Map({ 
                    container: 'map-reg', 
                    style: 'mapbox://styles/mapbox/navigation-night-v1', 
                    center: [112.74, -7.287], 
                    zoom: 13 
                });
                
                this.regMarker = new mapboxgl.Marker({ color: '#ef4444' })
                    .setLngLat([112.74, -7.287]).addTo(this.mapReg);
                
                this.mapReg.on('click', (e) => {
                    this.selectedRegCoords = e.lngLat;
                    this.regMarker.setLngLat(e.lngLat);
                });

                this.mapReg.on('load', () => {
                    this.bssList.forEach((bss) => {
                        new mapboxgl.Marker({ color: '#10b981', scale: 0.6 })
                            .setLngLat([bss.long, bss.lat]).addTo(this.mapReg);
                    });
                });
            }

            initScanner() {
                const config = { fps: 10, qrbox: { width: 220, height: 220 } };
                this.scanner.start({ facingMode: "environment" }, config, (text) => {
                    this.batteryId = text;
                    document.getElementById('id-text').innerText = text;
                    document.getElementById('qr-display').classList.remove('hidden');
                    if(navigator.vibrate) navigator.vibrate(100);
                }).catch(err => console.log("Kamera stand-by"));
            }

            switchTab(tab) {
                ['log', 'pred', 'admin-bss', 'admin-bat'].forEach(id => {
                    document.getElementById(`section-${id}`).classList.add('hidden');
                });
                
                ['log', 'pred', 'admin-bss', 'admin-bat'].forEach(id => {
                    const el = document.getElementById(`tab-${id}`);
                    if(el) {
                        el.className = el.className.replace('bg-blue-600 text-white shadow-lg', 'text-slate-400');
                        el.className = el.className.replace('bg-emerald-600 text-white shadow-lg border-transparent', 'text-emerald-400 border border-emerald-900/50');
                        el.className = el.className.replace('bg-purple-600 text-white shadow-lg border-transparent', 'text-purple-400 border border-purple-900/50');
                    }
                });

                document.getElementById(`section-${tab}`).classList.remove('hidden');
                
                if (tab === 'log' || tab === 'pred') {
                    document.getElementById(`tab-${tab}`).className = `flex-1 py-2 rounded-xl text-[11px] font-bold bg-blue-600 text-white shadow-lg`;
                } else if (tab === 'admin-bss') {
                    document.getElementById(`tab-${tab}`).className = `flex-1 py-2 rounded-xl text-[11px] font-bold bg-emerald-600 text-white shadow-lg border border-transparent`;
                    setTimeout(() => { this.mapReg.resize(); }, 300);
                } else if (tab === 'admin-bat') {
                    document.getElementById(`tab-${tab}`).className = `flex-1 py-2 rounded-xl text-[11px] font-bold bg-purple-600 text-white shadow-lg border border-transparent`;
                }
            }

            calculatePrediction() {
                const km = parseFloat(document.getElementById('inp-km').value) || 0;
                const maxKm = this.predictMode === 'eco' ? 65 : 55;
                
                let requiredBattery = Math.ceil((km / maxKm) * 100) + 5; 
                if (requiredBattery > 100) requiredBattery = 100;
                if (km === 0) requiredBattery = 0;

                const resEl = document.getElementById('txt-pred-result');
                resEl.innerText = `${requiredBattery}%`;
                resEl.className = requiredBattery > 80 ? "text-4xl font-black text-red-500" : 
                                  requiredBattery > 50 ? "text-4xl font-black text-yellow-500" : "text-4xl font-black text-emerald-400";
            }

            async loadBatteryTable() {
                const bats = await this.db.fetchBatteries();
                const tbody = document.getElementById('tbl-batteries');
                tbody.innerHTML = '';
                bats.forEach(b => {
                    tbody.innerHTML += `
                        <tr class="hover:bg-slate-800">
                            <td class="px-3 py-3 font-mono text-blue-400">${b.id_baterai}</td>
                            <td class="px-3 py-3 text-slate-500">${new Date(b.timestamp).toLocaleDateString('id-ID')}</td>
                        </tr>
                    `;
                });
            }

            renderBssDropdown() {
                const select = document.getElementById('select-bss');
                if (!select) return;
                select.innerHTML = '<option value="new">➕ BUAT BSS BARU</option>';
                this.bssList.forEach(bss => {
                    const opt = document.createElement('option');
                    opt.value = bss.id; 
                    opt.textContent = `📝 EDIT: ${bss.nama_bss.toUpperCase()}`;
                    select.appendChild(opt);
                });
            }

            initListeners() {
                // --- LOGOUT ACTION ---
                document.getElementById('btn-logout').addEventListener('click', async () => {
                    await this.db.logout(); location.reload();
                });

                // --- SLIDER LOG BATERAI ---
                document.getElementById('inp-range-drop').addEventListener('input', (e) => {
                    document.getElementById('val-range-drop').innerText = e.target.value + "%";
                });
                document.getElementById('inp-range-pick').addEventListener('input', (e) => {
                    document.getElementById('val-range-pick').innerText = e.target.value + "%";
                });

                // --- SIMPAN LOG BATERAI ---
                document.getElementById('btn-save-log').addEventListener('click', async () => {
                    if (!this.batteryId) return alert("Scan QR Baterai Baru dulu rek!");
                    
                    const logData = {
                        id_baterai: this.batteryId, 
                        persentase_drop: parseInt(document.getElementById('inp-range-drop').value),
                        persentase_pick: parseInt(document.getElementById('inp-range-pick').value),
                        user_id: this.currentUser ? this.currentUser.id : null 
                    };

                    const { error } = await this.db.saveLog(logData);
                    if (error) alert("Gagal Simpan: " + error.message); else { alert("✅ Data Swap Tersimpan!"); location.reload(); }
                });

                // --- PREDIKSI BATERAI ---
                document.getElementById('inp-km').addEventListener('input', () => this.calculatePrediction());
                document.getElementById('btn-mode-eco').addEventListener('click', (e) => {
                    this.predictMode = 'eco';
                    e.target.className = "flex-1 py-3 rounded-xl text-xs font-bold bg-emerald-600 text-white border border-emerald-500 transition-all";
                    document.getElementById('btn-mode-normal').className = "flex-1 py-3 rounded-xl text-xs font-bold bg-slate-700 text-slate-300 border border-slate-600 transition-all";
                    this.calculatePrediction();
                });
                document.getElementById('btn-mode-normal').addEventListener('click', (e) => {
                    this.predictMode = 'normal';
                    e.target.className = "flex-1 py-3 rounded-xl text-xs font-bold bg-blue-600 text-white border border-blue-500 transition-all";
                    document.getElementById('btn-mode-eco').className = "flex-1 py-3 rounded-xl text-xs font-bold bg-slate-700 text-slate-300 border border-slate-600 transition-all";
                    this.calculatePrediction();
                });

                // --- [FIX] PENGELOLAAN ADMIN BSS (PINDAH KE SINI) ---
                document.getElementById('btn-use-gps').addEventListener('click', () => {
                    if (navigator.geolocation) {
                        navigator.geolocation.getCurrentPosition((pos) => {
                            const lng = pos.coords.longitude;
                            const lat = pos.coords.latitude;
                            this.selectedRegCoords = { lng, lat };
                            this.regMarker.setLngLat([lng, lat]);
                            this.mapReg.flyTo({ center: [lng, lat], zoom: 18, essential: true });
                            if(navigator.vibrate) navigator.vibrate(50);
                        }, (err) => {
                            alert("Gagal ambil GPS: Pastikan izin lokasi aktif.");
                        }, { enableHighAccuracy: true });
                    } else {
                        alert("Browser tidak dukung GPS.");
                    }
                });

                document.getElementById('btn-save-bss').addEventListener('click', async () => {
                    const name = document.getElementById('inp-bss-name').value;
                    if (!name) return alert("Isi nama stasiun dulu!");
                    if (!this.selectedRegCoords) return alert("Tentukan lokasi di peta atau klik Tandai Lokasi Saya!");
                    
                    const { error } = await this.db.saveBSS({ 
                        nama_bss: name, 
                        lat: this.selectedRegCoords.lat, 
                        long: this.selectedRegCoords.lng 
                    });
                    if (error) alert("Error: " + error.message); 
                    else { alert("✅ BSS Berhasil Tersimpan!"); location.reload(); }
                });

                const selectBss = document.getElementById('select-bss');
                if (selectBss) {
                    selectBss.addEventListener('change', (e) => {
                        const val = e.target.value;
                        const inputName = document.getElementById('inp-bss-name');
                        const actionCreate = document.getElementById('action-create');
                        const actionEdit = document.getElementById('action-edit');

                        if (val === 'new') {
                            this.editingBssId = null; 
                            inputName.value = '';
                            actionCreate.classList.replace('hidden', 'block'); 
                            actionEdit.classList.replace('flex', 'hidden');
                        } else {
                            this.editingBssId = val; 
                            const bss = this.bssList.find(b => b.id == val);
                            if (bss) {
                                inputName.value = bss.nama_bss;
                                actionCreate.classList.replace('block', 'hidden'); 
                                actionEdit.classList.replace('hidden', 'flex');
                                
                                // Geser Peta ke Lokasi BSS yang mau diedit
                                this.selectedRegCoords = { lng: bss.long, lat: bss.lat };
                                this.regMarker.setLngLat([bss.long, bss.lat]);
                                this.mapReg.flyTo({ center: [bss.long, bss.lat], zoom: 17, essential: true });
                            }
                        }
                    });
                }

                // --- [BARU] AKSI TOMBOL UPDATE BSS ---
                document.getElementById('btn-update-bss').addEventListener('click', async () => {
                    const name = document.getElementById('inp-bss-name').value;
                    const coords = this.selectedRegCoords;
                    if (!name || !this.editingBssId) return alert("Pilih BSS dan isi namanya!");
                    if (!coords) return alert("Titik belum ditentukan!");

                    const { error } = await this.db.updateBSS(this.editingBssId, { nama_bss: name, lat: coords.lat, long: coords.lng });
                    if (error) alert("Gagal Update: " + error.message); 
                    else { alert("✅ BSS Berhasil Diupdate!"); location.reload(); }
                });

                // --- [BARU] AKSI TOMBOL DELETE BSS ---
                document.getElementById('btn-delete-bss').addEventListener('click', async () => {
                    if (!this.editingBssId) return;
                    if (confirm("⚠️ Yakin mau menghapus stasiun BSS ini? Data akan hilang selamanya!")) {
                        const { error } = await this.db.deleteBSS(this.editingBssId);
                        if (error) alert("Gagal Hapus: " + error.message); 
                        else { alert("🗑️ BSS Berhasil Dihapus!"); location.reload(); }
                    }
                });
            }
        }

        const app = new ElectrumApp();