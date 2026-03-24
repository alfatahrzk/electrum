const CONFIG = {
    MAPBOX_KEY: 'pk.eyJ1IjoiYWxmYXRhaHJ6ayIsImEiOiJjbW4zZjk1czgxY2NrMm9xNW1xeDNjNGplIn0.kTnR7XkvTxRPM_Te-rPZnw',
    SUPABASE_URL: 'https://zjpnsqixrrjdjpwdtrsu.supabase.co',
    SUPABASE_KEY: 'sb_publishable_9UZqhqNpj5-sZcUgiXz-vQ_oyzd2gHZ'
};

const supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);