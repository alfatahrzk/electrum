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

            async fetchAnalytics(userId = null) {
                let query = this.client.from('battery_logs').select('persentase_drop, persentase_pick');
                
                // Kalau ada userId (User biasa yang login), filter datanya khusus milik dia saja
                if (userId) {
                    query = query.eq('user_id', userId);
                }
                
                const { data, error } = await query;
                if (error) {
                    console.error("Error fetch analytics:", error);
                    return [];
                }
                return data || [];
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

            async fetchBatteryHistory(id_baterai) {
                const { data, error } = await this.client
                    .from('battery_logs')
                    .select('*')
                    .eq('id_baterai', id_baterai)
                    .order('timestamp', { ascending: false });
                
                if (error) { console.error("Error lacak:", error); return []; }
                return data || [];
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
                this.uniqueBatteries = [];

                const sekarang = new Date();
                this.selectedHour = sekarang.getHours().toString().padStart(2, '0');
                this.selectedMin = sekarang.getMinutes().toString().padStart(2, '0');

                this.init();
            }

            async init() {
                await this.checkAuthStatus();
                this.initScanner();
                this.initListeners();

                // [BARU] Set angka input manual ke jam sekarang
                document.getElementById('inp-hour-manual').value = this.selectedHour;
                document.getElementById('inp-min-manual').value = this.selectedMin;
                
                this.bssList = await this.db.fetchBSS();
                this.renderAnalytics(); 
                this.renderBssRecommendation(); // Prediksi otomatis jam sekarang
                
                if(this.userRole === 'admin') {
                    this.initAdminMap();
                    this.loadBatteryTable();
                    this.renderBssDropdown();
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

            playSuccessSound() {
                try {
                    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const oscillator = audioCtx.createOscillator();
                    const gainNode = audioCtx.createGain();

                    oscillator.connect(gainNode);
                    gainNode.connect(audioCtx.destination);

                    oscillator.type = 'sine'; // Suara lembut tapi jelas
                    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // Nada tinggi (A5)
                    
                    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
                    gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.01);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

                    oscillator.start(audioCtx.currentTime);
                    oscillator.stop(audioCtx.currentTime + 0.2); // Durasi 0.2 detik
                } catch (e) {
                    console.log("Audio diblokir browser, butuh interaksi user dulu.");
                }
            }

            calculateDistance(lat1, lon1, lat2, lon2) {
                const R = 6371e3; // Radius bumi dalam meter
                const dLat = (lat2 - lat1) * Math.PI / 180;
                const dLon = (lon2 - lon1) * Math.PI / 180;
                const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                          Math.sin(dLon/2) * Math.sin(dLon/2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                return R * c; // Jarak dalam meter
            }

            switchTab(tab) {
                ['log', 'pred', 'analisis', 'admin-bss', 'admin-bat'].forEach(id => {
                    document.getElementById(`section-${id}`).classList.add('hidden');
                });
                
                ['log', 'pred', 'analisis', 'admin-bss', 'admin-bat'].forEach(id => {
                    const el = document.getElementById(`tab-${id}`);
                    if(el) {
                        el.className = el.className.replace('bg-blue-600 text-white shadow-lg', 'text-slate-400');
                        el.className = el.className.replace('bg-emerald-600 text-white shadow-lg border-transparent', 'text-emerald-400 border border-emerald-900/50');
                        el.className = el.className.replace('bg-purple-600 text-white shadow-lg border-transparent', 'text-purple-400 border border-purple-900/50');
                    }
                });

                document.getElementById(`section-${tab}`).classList.remove('hidden');
                
                if (tab === 'log' || tab === 'pred' || tab === 'analisis') {
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

            async renderBssRecommendation() {
                const listEl = document.getElementById('list-rekomendasi-bss');
                if (!listEl) return;

                listEl.innerHTML = '<p class="text-[10px] text-slate-500 text-center py-4 animate-pulse">Menghitung data historis...</p>';

                // 1. Ambil data logs
                const { data: logs, error } = await this.db.client
                    .from('battery_logs')
                    .select('id_bss, persentase_pick, timestamp');
                
                if (error) {
                    listEl.innerHTML = '<p class="text-[10px] text-red-400 text-center">Gagal memuat data.</p>';
                    return;
                }

                // 2. Filter berdasarkan JAM (Input Manual)
                const targetHour = parseInt(this.selectedHour || 10);
                const filteredLogs = (logs || []).filter(log => {
                    const logDate = new Date(log.timestamp);
                    return logDate.getHours() === targetHour;
                });

                // 3. Hitung Statistik
                const bssScores = {};
                filteredLogs.forEach(log => {
                    if (log.id_bss) {
                        if (!bssScores[log.id_bss]) bssScores[log.id_bss] = { count: 0, total: 0 };
                        bssScores[log.id_bss].count++;
                        bssScores[log.id_bss].total += log.persentase_pick;
                    }
                });

                // 4. Ranking
                const ranked = this.bssList.map(bss => {
                    const s = bssScores[bss.id] || { count: 0, total: 0 };
                    return { ...bss, score: s.count, avg: s.count > 0 ? Math.round(s.total/s.count) : 0 };
                })
                .filter(b => b.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 3);

                // 5. Render ke UI
                listEl.innerHTML = '';
                if (ranked.length === 0) {
                    listEl.innerHTML = `<p class="text-[10px] text-slate-500 text-center bg-slate-900/30 p-4 rounded-xl italic">Belum ada data swap pada jam ${targetHour.toString().padStart(2,'0')}:00.</p>`;
                    return;
                }

                ranked.forEach((b, i) => {
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
                    listEl.innerHTML += `
                        <div class="bg-slate-900/50 p-3 rounded-2xl border border-slate-700 flex justify-between items-center">
                            <div class="flex items-center gap-3">
                                <span class="text-xl">${medal}</span>
                                <div>
                                    <p class="text-[10px] font-black text-emerald-400">${b.nama_bss.toUpperCase()}</p>
                                    <p class="text-[8px] text-slate-500 uppercase font-bold">${b.score} Kali Swap</p>
                                </div>
                            </div>
                            <div class="text-right">
                                <p class="text-[8px] text-slate-500 uppercase font-bold">Estimasi</p>
                                <p class="text-sm font-black text-blue-400">${b.avg}%</p>
                            </div>
                        </div>`;
                });
            }

            async renderAnalytics() {
                // Sesuai janji: User = Personal, Publik/Admin = Global
                const isUserOnly = this.userRole === 'user';
                const fetchId = isUserOnly ? this.currentUser.id : null;
                
                document.getElementById('txt-analisis-title').innerText = isUserOnly ? "Analisis Personal" : "Analisis Global";
                document.getElementById('txt-analisis-subtitle').innerText = isUserOnly ? "Riwayat swap baterai kamu" : "Data swap seluruh komunitas";

                const data = await this.db.fetchAnalytics(fetchId);
                
                document.getElementById('stat-total-swap').innerText = data.length;
                
                if (data.length > 0) {
                    const totalDrop = data.reduce((sum, row) => sum + row.persentase_drop, 0);
                    const totalPick = data.reduce((sum, row) => sum + row.persentase_pick, 0);
                    
                    document.getElementById('stat-avg-drop').innerText = Math.round(totalDrop / data.length) + "%";
                    document.getElementById('stat-avg-pick').innerText = Math.round(totalPick / data.length) + "%";
                } else {
                    document.getElementById('stat-avg-drop').innerText = "0%";
                    document.getElementById('stat-avg-pick').innerText = "0%";
                }
            }

            async loadBatteryTable(searchQuery = '') {
                // Tarik data dari DB cuma sekali di awal, sisanya pakai memori biar ngebut
                if (this.uniqueBatteries.length === 0) {
                    this.uniqueBatteries = await this.db.fetchBatteries();
                }

                const tbody = document.getElementById('tbl-batteries');
                tbody.innerHTML = '';

                // Fitur Search Bar
                const filtered = this.uniqueBatteries.filter(b => 
                    b.id_baterai.toLowerCase().includes(searchQuery.toLowerCase())
                );

                filtered.forEach(b => {
                    tbody.innerHTML += `
                        <tr class="hover:bg-slate-800 border-b border-slate-700/50">
                            <td class="px-3 py-3 font-mono text-blue-400 text-[10px] break-all">${b.id_baterai}</td>
                            <td class="px-3 py-3 text-right">
                                <button onclick="app.openTrackModal('${b.id_baterai}')" class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-lg transition-all active:scale-95">
                                    🔍 LACAK
                                </button>
                            </td>
                        </tr>
                    `;
                });
            }

            async openTrackModal(id_baterai) {
                document.getElementById('modal-track').classList.remove('hidden');
                document.getElementById('track-id-baterai').innerText = id_baterai;
                
                const listEl = document.getElementById('track-list');
                listEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-6 animate-pulse">Memuat riwayat detektif...</p>';

                const history = await this.db.fetchBatteryHistory(id_baterai);
                listEl.innerHTML = '';

                if (history.length === 0) {
                    listEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-6">Tidak ada riwayat pertukaran.</p>';
                    return;
                }

                history.forEach(log => {
                    // Cek lokasi BSS
                    let bssName = "Lokasi Swap Publik / Di Jalan";
                    if (log.id_bss) {
                        const bss = this.bssList.find(b => b.id === log.id_bss);
                        if (bss) bssName = bss.nama_bss;
                    }

                    // Format Tanggal
                    const dateStr = new Date(log.timestamp).toLocaleString('id-ID', {
                        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    });

                    listEl.innerHTML += `
                        <div class="bg-slate-900/80 p-4 rounded-2xl border border-slate-700">
                            <div class="flex justify-between items-start mb-3 border-b border-slate-700/50 pb-2">
                                <span class="text-[11px] font-black text-emerald-400">📍 ${bssName.toUpperCase()}</span>
                                <span class="text-[10px] text-slate-400 font-mono">${dateStr}</span>
                            </div>
                            <div class="flex gap-4">
                                <div class="flex-1 bg-slate-800 p-2 rounded-xl text-center">
                                    <p class="text-[9px] text-slate-500 font-bold uppercase">Kondisi Drop</p>
                                    <p class="text-lg font-black text-red-400">${log.persentase_drop}%</p>
                                </div>
                                <div class="flex-1 bg-slate-800 p-2 rounded-xl text-center">
                                    <p class="text-[9px] text-slate-500 font-bold uppercase">Kondisi Pick</p>
                                    <p class="text-lg font-black text-blue-400">${log.persentase_pick}%</p>
                                </div>
                            </div>
                        </div>
                    `;
                });
            }

            // Memasukkan angka 00-23 ke dalam grid jam
            generateHourGrid() {
                const grid = document.getElementById('grid-hour');
                if (!grid) return;
                grid.innerHTML = '';
                
                for (let i = 0; i < 24; i++) {
                    const hourStr = i.toString().padStart(2, '0');
                    const isActive = hourStr === this.selectedHour ? 'active-time' : '';
                    
                    grid.innerHTML += `
                        <div onclick="app.setTime('hour', '${hourStr}', this)" 
                            class="time-cell-hour border border-slate-600 bg-slate-700 text-white text-center py-1.5 rounded text-[10px] cursor-pointer hover:bg-blue-600 transition-colors ${isActive}">
                            ${hourStr}
                        </div>
                    `;
                }
            }

            // Fungsi saat kotak jam/menit diklik
            setTime(type, val, el) {
                if (type === 'hour') {
                    this.selectedHour = val;
                    document.querySelectorAll('.time-cell-hour').forEach(c => c.classList.remove('active-time'));
                } else {
                    this.selectedMin = val;
                    document.querySelectorAll('.time-cell-min').forEach(c => c.classList.remove('active-time'));
                }
                
                el.classList.add('active-time');
                document.getElementById('txt-selected-time').innerText = `Menampilkan prediksi untuk Jam ${this.selectedHour}:${this.selectedMin}`;
                
                // Panggil ulang prediksi setiap kali waktu berubah
                this.renderBssRecommendation();
                if(navigator.vibrate) navigator.vibrate(20); // Getar halus biar berasa tactile
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
                    if (!this.batteryId) return alert("Scan QR Baterai dulu!");

                    const btn = document.getElementById('btn-save-log');
                    btn.innerText = "⏳ MENGUNCI LOKASI BSS...";
                    btn.disabled = true;

                    // 1. Ambil Koordinat GPS Real-time
                    const getPos = () => {
                        return new Promise((resolve, reject) => {
                            navigator.geolocation.getCurrentPosition(
                                (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                                (err) => reject(err),
                                { enableHighAccuracy: true }
                            );
                        });
                    };

                    try {
                        const userPos = await getPos();
                        let lockedBssId = null;
                        let bssName = "";

                        // 2. LOGIKA AUTO-LOCK: Cari BSS dalam radius 50 meter
                        this.bssList.forEach(bss => {
                            const dist = this.calculateDistance(userPos.lat, userPos.lng, bss.lat, bss.long);
                            if (dist <= 50) { // Toleransi 50 meter sesuai rencana awal
                                lockedBssId = bss.id;
                                bssName = bss.nama_bss;
                            }
                        });

                        // 3. Validasi: Jika tidak ada BSS dalam radius 50m, batalkan!
                        if (!lockedBssId) {
                            btn.innerText = "KIRIM DATA SWAP";
                            btn.disabled = false;
                            return alert("❌ GAGAL: Kamu tidak berada di radius Stasiun BSS (Maks 50m). Silakan mendekat ke stasiun!");
                        }

                        // 4. Susun Data (Otomatis dapat id_bss)
                        const logData = {
                            id_baterai: this.batteryId,
                            id_bss: lockedBssId, 
                            persentase_drop: parseInt(document.getElementById('inp-range-drop').value),
                            persentase_pick: parseInt(document.getElementById('inp-range-pick').value),
                            user_id: this.currentUser ? this.currentUser.id : null,
                            lat: userPos.lat,
                            long: userPos.lng,
                            timestamp: new Date().toISOString()
                        };

                        // 5. Kirim Online/Offline
                        if (!navigator.onLine) {
                            let offlineLogs = JSON.parse(localStorage.getItem('offline_logs') || '[]');
                            offlineLogs.push(logData);
                            localStorage.setItem('offline_logs', JSON.stringify(offlineLogs));
                            alert(`⚠️ OFFLINE: Terkunci di BSS ${bssName}. Data disimpan di HP!`);
                            location.reload();
                        } else {
                            const { error } = await this.db.saveLog(logData);
                            if (error) throw error;
                            alert(`✅ BERHASIL: Swap di BSS ${bssName} tercatat!`);
                            location.reload();
                        }

                    } catch (err) {
                        alert("Kesalahan GPS: Pastikan Izin Lokasi Aktif!");
                        btn.innerText = "KIRIM DATA SWAP";
                        btn.disabled = false;
                    }
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

                const btnCek = document.getElementById('btn-cek-prediksi');
                if (btnCek) {
                    btnCek.addEventListener('click', () => {
                        // Ambil nilai dari input manual
                        this.selectedHour = document.getElementById('inp-hour-manual').value;
                        this.selectedMin = document.getElementById('inp-min-manual').value;
                        
                        // Validasi angka
                        if(this.selectedHour > 23 || this.selectedHour < 0) return alert("Jam salah boss (0-23)!");
                        
                        this.renderBssRecommendation();
                        if(navigator.vibrate) navigator.vibrate(50);
                    });
                }

                // --- PENCARIAN & MODAL TRACKING ---
                const searchBat = document.getElementById('inp-search-bat');
                if (searchBat) {
                    searchBat.addEventListener('input', (e) => this.loadBatteryTable(e.target.value));
                }
                
                const btnCloseTrack = document.getElementById('btn-close-track');
                if (btnCloseTrack) {
                    btnCloseTrack.addEventListener('click', () => {
                        document.getElementById('modal-track').classList.add('hidden');
                    });
                }

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