#!/usr/bin/env python3
"""
VOYO ULTIMATE FEEDER - Built by DASH & ZION
============================================

THE WHOLE DIASPORA. THE WHOLE CULTURE. NO RESTRAINTS.

Coverage:
- ALL Africa (every country, every genre)
- ALL Black Diaspora (US, UK, Caribbean, Brazil, everywhere)
- ALL Trendy categories (TikTok, viral, charts)
- ALL Moods (party, chill, workout, love, everything)
- ALL Years (2024 back to classics)

Target: 1 MILLION TRACKS
"""

import json
import time
import random
import urllib.request
from typing import List, Dict, Set
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import sys

try:
    from ytmusicapi import YTMusic
except ImportError:
    import subprocess
    subprocess.run(["pip3", "install", "ytmusicapi", "--break-system-packages", "-q"])
    from ytmusicapi import YTMusic

# ============================================
# SUPABASE CONFIG
# ============================================

SUPABASE_URL = 'https://anmgyxhnyhbyxzpjhxgx.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFubWd5eGhueWhieXh6cGpoeGd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NzE3NDAsImV4cCI6MjA4MTU0Nzc0MH0.VKzfgrAbwvfs6WC1xhVbJ-mShmex3ycfib8jI57dyR4'

# Thread-safe
class AtomicCounter:
    def __init__(self):
        self.value = 0
        self.lock = threading.Lock()
    def add(self, n):
        with self.lock:
            self.value += n
            return self.value
    def get(self):
        with self.lock:
            return self.value

total_synced = AtomicCounter()
total_discovered = AtomicCounter()
seen_ids: Set[str] = set()
seen_lock = threading.Lock()

# ============================================
# THE ULTIMATE DATABASE - EVERYTHING
# ============================================

ULTIMATE_DOMAINS = {
    # ==========================================
    # AFRICA - EVERY REGION
    # ==========================================
    "west_africa_nigeria": {
        "artists": [
            # Afrobeats Kings & Queens
            "Burna Boy", "Wizkid", "Davido", "Tiwa Savage", "Rema", "Asake",
            "Fireboy DML", "Omah Lay", "Ayra Starr", "CKay", "Tems", "BNXN",
            "Joeboy", "Kizz Daniel", "Olamide", "Wande Coal", "Tekno", "Yemi Alade",
            "Patoranking", "Mr Eazi", "Flavour", "Adekunle Gold", "Simi", "Falz",
            "Zlatan", "Naira Marley", "Mayorkun", "Peruzzi", "Oxlade", "Ruger",
            "Lojay", "Victony", "Blaqbonez", "Bella Shmurda", "Portable", "Seyi Vibez",
            "Boy Spyce", "Khaid", "Shallipopi", "Crayon", "Chike", "Johnny Drille",
            "Ladipoe", "Reminisce", "Phyno", "Zoro", "IllBliss", "Ice Prince",
            "Jesse Jagz", "M.I Abaga", "Vector", "Psycho YP", "Blaqbonez",
            "Odumodu Blvck", "Odumodublvck", "Magixx", "T.I Blaze", "Young Jonn",
            "Spyro", "1da Banton", "Bayanni", "Lil Kesh", "Ycee", "Dremo",
            # Nigerian Legends
            "2Baba", "2face Idibia", "D'banj", "Don Jazzy", "P-Square", "Psquare",
            "Timaya", "Duncan Mighty", "Bracket", "Banky W", "Naeto C", "Mode 9",
            "Olu Maintain", "Tony Tetuila", "Plantation Boyz", "Remedies",
            "Styl Plus", "Faze", "Sound Sultan", "9ice", "Darey Art Alade",
            "Bez", "Cobhams Asuquo", "Asa", "Omawumi", "Waje", "Chidinma",
            # Gospel
            "Sinach", "Frank Edwards", "Tim Godfrey", "Mercy Chinwo", "Ada Ehi",
            "Nathaniel Bassey", "Dunsin Oyekan", "Tope Alabi", "Panam Percy Paul",
        ],
        "queries": [
            "naija music 2024", "naija music 2023", "nigerian music 2024",
            "afrobeats 2024", "afrobeats 2023", "afrobeats hits",
            "nigerian wedding songs", "naija party mix", "alte music nigeria",
            "nigerian hip hop", "naija rap", "nigerian gospel 2024",
        ]
    },

    "west_africa_ghana": {
        "artists": [
            "Sarkodie", "Stonebwoy", "Shatta Wale", "King Promise", "Gyakie",
            "Black Sherif", "Kuami Eugene", "KiDi", "Camidoh", "Amaarae",
            "Kwesi Arthur", "Medikal", "Efya", "R2Bees", "Kofi Kinaata",
            "Daddy Lumba", "Kojo Antwi", "Ofori Amponsah", "Samini", "Edem",
            "Bisa Kdei", "MzVee", "Wendy Shay", "Sista Afia", "Fameye",
            "Joey B", "Darkovibes", "Mr Drew", "Lasmid", "Amerado",
            "Strongman", "Eno Barony", "Kelvyn Boy", "Joeboy Ghana", "Twitch 4EVA",
            "Nacee", "Joe Mettle", "Diana Hamilton", "Celestine Donkor", "MOG Music",
            "Okyeame Kwame", "Reggie Rockstone", "Tic Tac", "VIP", "Praye",
            "Castro", "Guru", "Gasmilla", "Wanlov", "M.anทfest",
        ],
        "queries": [
            "ghana music 2024", "ghana music 2023", "highlife music ghana",
            "azonto music", "ghana hiplife", "ghana afrobeats", "ghana drill",
            "ghanaian gospel 2024", "ghana party songs", "ghana love songs",
        ]
    },

    "west_africa_francophone": {
        "artists": [
            # Senegal
            "Youssou N'Dour", "Baaba Maal", "Ismaël Lô", "Wally Seck", "Viviane Chidid",
            "Akon", "Pape Diouf", "Thione Seck", "Omar Pene", "Coumba Gawlo",
            "Didier Awadi", "Duggy Tee", "Daara J Family", "Positive Black Soul",
            # Mali
            "Salif Keita", "Oumou Sangaré", "Amadou & Mariam", "Toumani Diabaté",
            "Rokia Traoré", "Fatoumata Diawara", "Habib Koité", "Ali Farka Touré",
            "Tinariwen", "Songhoy Blues", "Aya Nakamura",
            # Ivory Coast
            "DJ Arafat", "Serge Beynaud", "Debordo Leekunfa", "Koffi Olomide",
            "Magic System", "Meiway", "Alpha Blondy", "Tiken Jah Fakoly",
            "Josey", "Suspect 95", "Didi B", "Vegedream",
            # Other West Africa
            "Mory Kanté", "Bembeya Jazz", "Youssou Ndour",
        ],
        "queries": [
            "musique senegalaise", "mbalax music", "coupé décalé 2024",
            "musique ivoirienne", "afro trap francais", "afro francophone",
            "musique malienne", "desert blues", "west african music",
        ]
    },

    "central_africa": {
        "artists": [
            # Congo DRC
            "Fally Ipupa", "Innoss'B", "Gaz Mawete", "Ferre Gola", "Koffi Olomide",
            "Werrason", "Papa Wemba", "Franco Luambo", "Tabu Ley Rochereau",
            "Awilo Longomba", "Extra Musica", "Wenge Musica", "Quartier Latin",
            "Madilu System", "Lokua Kanza", "Richard Bona", "Ray Lema",
            "Faya Tess", "Heritier Watanabe", "Fabregas", "Robinio Mundibu",
            # Cameroon
            "Manu Dibango", "Richard Bona", "Charlotte Dipanda", "Locko",
            "Mr Leo", "Salatiel", "Daphne", "Blanche Bailly", "Ko-C",
            "Stanley Enow", "Jovi", "Tenor", "Reniss", "Lady Ponce",
            # Gabon, CAR, etc
            "Patience Dabany", "Oliver N'Goma", "Annie Flore Batchiellilys",
        ],
        "queries": [
            "rumba congolaise", "ndombolo music 2024", "musique congolaise",
            "soukous music", "cameroon music 2024", "makossa music",
            "bikutsi music", "central african music",
        ]
    },

    "east_africa": {
        "artists": [
            # Tanzania
            "Diamond Platnumz", "Harmonize", "Zuchu", "Rayvanny", "Ali Kiba",
            "Mbosso", "Nandy", "Jux", "Navy Kenzo", "Vanessa Mdee",
            "Barnaba", "Lava Lava", "Rich Mavoko", "Darassa", "Christian Bella",
            "Lady Jaydee", "Professor Jay", "Mr Nice", "Mwana FA",
            # Kenya
            "Sauti Sol", "Nyashinski", "Otile Brown", "Nviiri the Storyteller",
            "Bien", "Savara", "Chimano", "Khaligraph Jones", "Octopizzo",
            "Bahati", "Willy Paul", "Nadia Mukami", "Tanasha Donna", "Fena Gitu",
            "Bensoul", "Nviiri", "Mejja", "Trio Mio", "Boutross",
            "E-Sir", "Nameless", "Jua Cali", "Nonini", "Prezzo",
            # Uganda
            "Eddy Kenzo", "Bebe Cool", "Sheebah", "Vinka", "Cindy Sanyu",
            "Rema Namakula", "Jose Chameleone", "Bobi Wine", "Pallaso",
            "Ykee Benda", "Fik Fameica", "A Pass", "Irene Ntale",
            # Rwanda/Burundi
            "Meddy", "The Ben", "Bruce Melodie", "Butera Knowless",
            "Riderman", "King James", "Urban Boys", "Miss Jojo",
            # Ethiopia
            "Teddy Afro", "Aster Aweke", "Tilahun Gessesse", "Mahmoud Ahmed",
            "Gigi", "Mulatu Astatke", "Hailu Mergia",
        ],
        "queries": [
            "bongo flava 2024", "bongo flava mix", "tanzanian music 2024",
            "kenyan music 2024", "gengetone music", "arbantone music",
            "ugandan music 2024", "kadongo kamu", "east african hits",
            "ethiopian music 2024", "ethio jazz", "swahili songs",
        ]
    },

    "southern_africa": {
        "artists": [
            # South Africa
            "Nasty C", "AKA", "Cassper Nyovest", "Focalistic", "DJ Maphorisa",
            "Kabza De Small", "Sha Sha", "Ami Faku", "Elaine", "Blxckie",
            "Master KG", "Makhadzi", "Sho Madjozi", "Black Coffee", "A-Reece",
            "Sun-El Musician", "Prince Kaybee", "Zakes Bantwini", "Samthing Soweto",
            "Msaki", "Sjava", "Kwesta", "Emtee", "YoungstaCPT", "Reason",
            "Major League DJz", "DBN Gogo", "Uncle Waffles", "Musa Keys", "Tyler ICU",
            "Costa Titch", "Kamo Mphela", "Boohle", "Lady Du", "Daliwonga",
            "Young Stunna", "Kelvin Momo", "De Mthuda", "Busta 929",
            # SA Legends
            "Brenda Fassie", "Hugh Masekela", "Miriam Makeba", "Lucky Dube",
            "Johnny Clegg", "Ladysmith Black Mambazo", "Mafikizolo", "Freshlyground",
            "TKZee", "Mandoza", "Zola", "Pro Kid", "HHP",
            # Zimbabwe
            "Oliver Mtukudzi", "Thomas Mapfumo", "Winky D", "Jah Prayzah",
            "Killer T", "Ammara Brown", "Tocky Vibes", "ExQ", "Takura",
            # Other Southern
            "Sampa the Great", "Tamy Moyo", "Gemma Griffiths",
        ],
        "queries": [
            "amapiano 2024", "amapiano 2023", "amapiano mix 2024",
            "south african house", "gqom music", "kwaito music",
            "south african hip hop", "mzansi hits", "sa music 2024",
            "zimbabwe music 2024", "zim dancehall", "chimurenga music",
        ]
    },

    "north_africa": {
        "artists": [
            # Egypt
            "Amr Diab", "Tamer Hosny", "Mohamed Ramadan", "Wegz", "Marwan Moussa",
            "Ahmed Saad", "Hassan Shakosh", "Omar Kamal", "Hamza Namira",
            "Cairokee", "Sherine", "Angham", "Ruby", "Hakim", "Shaaban Abdel Rahim",
            # Morocco
            "Saad Lamjarred", "Samira Said", "Douzi", "RedOne", "French Montana",
            "Manal", "Hatim Ammor", "Ahmed Chawki", "Fnaire", "Dizzy Dros",
            # Algeria
            "Khaled", "Cheb Mami", "Rachid Taha", "Souad Massi", "Soolking",
            "L'Algérino", "Rim'K", "Lacrim", "DJ Snake", "Alonzo",
            # Tunisia
            "Balti", "Lotfi Double Kanon", "Hamzaoui Med Amine", "Klay BBJ",
            # Libya/Sudan
            "Ahmed Fakroun", "Mohammed Wardi", "Sinkane",
        ],
        "queries": [
            "arabic music 2024", "egyptian music 2024", "mahraganat music",
            "rai music", "moroccan music 2024", "algerian music",
            "arabic pop hits", "khaliji music", "arabic trap",
            "arabic wedding songs", "arabic party mix",
        ]
    },

    # ==========================================
    # BLACK DIASPORA - AMERICAS
    # ==========================================
    "usa_hiphop_rap": {
        "artists": [
            # Current Era
            "Drake", "Kendrick Lamar", "J. Cole", "Travis Scott", "Future",
            "Lil Baby", "Gunna", "Young Thug", "21 Savage", "Lil Durk",
            "Polo G", "Rod Wave", "NBA YoungBoy", "Megan Thee Stallion", "Cardi B",
            "Nicki Minaj", "Doja Cat", "GloRilla", "Latto", "Ice Spice",
            "Metro Boomin", "Don Toliver", "Baby Keem", "JID", "Denzel Curry",
            "Tyler the Creator", "A$AP Rocky", "Playboi Carti", "Lil Uzi Vert",
            "Jack Harlow", "Post Malone", "Lizzo", "SZA", "Summer Walker",
            # Legends
            "Jay-Z", "Nas", "Kanye West", "Eminem", "Snoop Dogg", "Dr. Dre",
            "50 Cent", "Lil Wayne", "T.I.", "Rick Ross", "2 Chainz",
            "Nelly", "Ludacris", "Outkast", "Big Boi", "Andre 3000",
            "DMX", "The Notorious B.I.G.", "Tupac", "Big Pun", "Wu-Tang Clan",
            "Mobb Deep", "Rakim", "KRS-One", "Public Enemy", "Run-DMC",
        ],
        "queries": [
            "hip hop 2024", "rap music 2024", "trap music 2024",
            "drill music 2024", "hip hop hits", "rap playlist",
            "old school hip hop", "90s hip hop", "2000s hip hop",
            "conscious rap", "lyrical rap", "underground hip hop",
        ]
    },

    "usa_rnb_soul": {
        "artists": [
            # Current
            "SZA", "Summer Walker", "Kehlani", "Jhené Aiko", "H.E.R.",
            "Daniel Caesar", "Giveon", "Brent Faiyaz", "Lucky Daye",
            "Victoria Monét", "Chloe x Halle", "Chloe Bailey", "Normani",
            "Chris Brown", "Bryson Tiller", "6LACK", "Ella Mai", "Snoh Aalegra",
            "Khalid", "dvsn", "PARTYNEXTDOOR", "The Weeknd", "Frank Ocean",
            # Legends
            "Beyoncé", "Rihanna", "Usher", "Ne-Yo", "Trey Songz",
            "Alicia Keys", "John Legend", "Mary J. Blige", "Lauryn Hill",
            "Erykah Badu", "D'Angelo", "Maxwell", "Jill Scott", "India.Arie",
            "R. Kelly", "Keith Sweat", "Boyz II Men", "New Edition",
            "Whitney Houston", "Mariah Carey", "Janet Jackson", "Prince",
            "Michael Jackson", "Stevie Wonder", "Aretha Franklin", "Ray Charles",
            "Otis Redding", "Sam Cooke", "James Brown", "Al Green",
        ],
        "queries": [
            "rnb 2024", "r&b music 2024", "rnb playlist", "slow jams",
            "rnb love songs", "neo soul music", "soul music",
            "90s rnb", "2000s rnb", "classic rnb", "rnb hits",
        ]
    },

    "usa_gospel": {
        "artists": [
            "Kirk Franklin", "Fred Hammond", "Donnie McClurkin", "Yolanda Adams",
            "Mary Mary", "Tamela Mann", "Tasha Cobbs Leonard", "Travis Greene",
            "Maverick City Music", "Elevation Worship", "Bethel Music",
            "Israel Houghton", "William Murphy", "Jonathan McReynolds",
            "Todd Dulaney", "Jekalyn Carr", "Le'Andria Johnson",
            "CeCe Winans", "BeBe Winans", "The Winans", "Andraé Crouch",
            "Mahalia Jackson", "The Clark Sisters", "Shirley Caesar",
        ],
        "queries": [
            "gospel music 2024", "gospel hits", "praise and worship",
            "gospel choir", "contemporary gospel", "black gospel",
            "gospel sunday", "worship music", "christian r&b",
        ]
    },

    "caribbean": {
        "artists": [
            # Jamaica - Reggae/Dancehall
            "Bob Marley", "Peter Tosh", "Jimmy Cliff", "Dennis Brown",
            "Buju Banton", "Shabba Ranks", "Beenie Man", "Bounty Killer",
            "Sean Paul", "Shaggy", "Vybz Kartel", "Popcaan", "Masicka",
            "Alkaline", "Chronic Law", "Skillibeng", "Skeng", "Valiant",
            "Spice", "Shenseea", "Koffee", "Lila Iké", "Protoje", "Chronixx",
            "Damian Marley", "Stephen Marley", "Ziggy Marley", "Julian Marley",
            "Tarrus Riley", "Busy Signal", "Mavado", "I-Octane", "Konshens",
            # Trinidad - Soca
            "Machel Montano", "Bunji Garlin", "Kes", "Destra Garcia",
            "Nailah Blackman", "Patrice Roberts", "Rikki Jai", "Voice",
            # Haiti
            "Wyclef Jean", "Sweet Micky", "T-Vice", "Klass", "Kai",
            # Others
            "Rihanna", "Kevin Lyttle", "Rupee", "Alison Hinds",
        ],
        "queries": [
            "reggae 2024", "dancehall 2024", "reggae classics",
            "dancehall mix", "jamaica music", "soca 2024",
            "soca carnival", "trinidad music", "haitian music",
            "caribbean party", "island vibes", "one drop reggae",
        ]
    },

    "brazil_afro_latin": {
        "artists": [
            # Brazilian
            "Anitta", "Ludmilla", "IZA", "Gloria Groove", "Pabllo Vittar",
            "Mc Kevinho", "Nego do Borel", "Lexa", "Luísa Sonza",
            "Mc Livinho", "Dennis DJ", "Kevinho", "Karol Conká",
            "Jorge Ben Jor", "Gilberto Gil", "Caetano Veloso", "Milton Nascimento",
            "Seu Jorge", "Djavan", "Tim Maia", "Alcione", "Beth Carvalho",
            # Afro-Latin
            "Celia Cruz", "Tito Puente", "Oscar D'León", "Buena Vista Social Club",
            "Compay Segundo", "Marc Anthony", "Romeo Santos", "Prince Royce",
            "Ozuna", "Bad Bunny", "J Balvin", "Daddy Yankee", "Don Omar",
        ],
        "queries": [
            "brazilian funk 2024", "funk carioca", "baile funk",
            "brazil music 2024", "axé music", "pagode music",
            "bossa nova", "mpb music", "samba music",
            "afro latin", "latin urban", "reggaeton 2024",
        ]
    },

    # ==========================================
    # UK BLACK MUSIC
    # ==========================================
    "uk_black_music": {
        "artists": [
            # UK Rap/Grime
            "Stormzy", "Dave", "Central Cee", "J Hus", "Skepta",
            "AJ Tracey", "Headie One", "Tion Wayne", "Russ Millions",
            "Digga D", "Fredo", "M Huncho", "Unknown T", "Knucks",
            "Little Simz", "Jorja Smith", "Ella Mai", "Ray BLK",
            "Kano", "Wiley", "Dizzee Rascal", "Giggs", "Krept & Konan",
            "Wretch 32", "Tinie Tempah", "Chipmunk", "Chip", "Lethal Bizzle",
            # Afroswing
            "NSG", "Not3s", "Yxng Bane", "Kojo Funds", "Maleek Berry",
            "Darkoo", "Ms Banks", "Miraa May", "Bellah", "Ama Lou",
            # UK R&B
            "Jorja Smith", "Mahalia", "RAYE", "Joy Crookes", "Bree Runway",
            "FLO", "Cleo Sol", "Pip Millett", "Nao",
        ],
        "queries": [
            "uk rap 2024", "uk drill 2024", "grime music",
            "afroswing music", "uk afrobeats", "uk r&b 2024",
            "british hip hop", "uk garage", "uk funky house",
        ]
    },

    # ==========================================
    # TRENDY & VIRAL
    # ==========================================
    "viral_trending": {
        "artists": [],
        "queries": [
            "tiktok songs 2024", "tiktok viral songs", "tiktok trending",
            "viral songs 2024", "trending music 2024", "spotify viral 50",
            "apple music top 100", "billboard hot 100", "global top 50",
            "most streamed songs 2024", "new music friday", "release radar",
            "viral african songs", "tiktok african songs", "trending afrobeats",
            "instagram reels songs", "youtube trending music",
        ]
    },

    "charts_yearly": {
        "artists": [],
        "queries": [
            # 2020s
            "best songs 2024", "best songs 2023", "best songs 2022",
            "best songs 2021", "best songs 2020",
            "top hits 2024", "top hits 2023", "top hits 2022",
            # 2010s
            "best songs 2019", "best songs 2018", "best songs 2017",
            "best songs 2016", "best songs 2015", "best songs 2014",
            "best songs 2013", "best songs 2012", "best songs 2011", "best songs 2010",
            "2010s hits", "2010s music", "2010s playlist",
            # 2000s
            "2000s hits", "2000s music", "2000s r&b", "2000s hip hop",
            "best songs 2009", "best songs 2005", "best songs 2000",
            # 90s
            "90s hits", "90s r&b", "90s hip hop", "90s music",
            # African specific
            "best african songs 2024", "best african songs 2023",
            "best afrobeats 2024", "best amapiano 2024",
            "african music awards", "headies nominations",
        ]
    },

    "moods_activities": {
        "artists": [],
        "queries": [
            # Moods
            "chill music", "relaxing music", "feel good music",
            "happy music", "sad songs", "heartbreak songs",
            "love songs 2024", "romantic songs", "slow jams",
            "hype music", "pump up songs", "motivation music",
            # Activities
            "workout music 2024", "gym playlist", "running music",
            "party music 2024", "club bangers", "pregame playlist",
            "study music", "focus music", "work music",
            "road trip songs", "driving music", "summer hits",
            "beach music", "pool party", "cookout music",
            "wedding songs", "wedding reception", "first dance songs",
            # Time of day
            "morning music", "evening chill", "late night vibes",
            "sunday morning", "friday night", "weekend playlist",
            # African moods
            "african chill", "african love songs", "african party",
            "african workout", "afrobeats party", "amapiano chill",
        ]
    },

    "genres_deep": {
        "artists": [],
        "queries": [
            # Electronic
            "house music 2024", "deep house", "tech house",
            "afro house", "afro tech", "electronic african",
            # Jazz/Blues
            "jazz music", "smooth jazz", "nu jazz", "jazz rap",
            "blues music", "modern blues", "soul blues",
            # Rock/Alternative
            "rock music", "alternative rock", "indie rock",
            "african rock", "afro rock", "african alternative",
            # Pop
            "pop music 2024", "dance pop", "synth pop",
            "afro pop", "african pop",
            # Other
            "lo-fi beats", "lo-fi hip hop", "chillhop",
            "trap soul", "alternative r&b", "indie soul",
        ]
    },

    # ==========================================
    # SPECIFIC PLAYLISTS & COMPILATIONS
    # ==========================================
    "compilations": {
        "artists": [],
        "queries": [
            # African compilations
            "african music compilation", "afrobeats compilation",
            "amapiano compilation", "bongo flava compilation",
            "naija mix", "ghana mix", "sa mix",
            # Diaspora compilations
            "hip hop compilation", "r&b compilation", "rap compilation",
            "reggae compilation", "dancehall compilation", "soca compilation",
            # Era compilations
            "throwback hits", "nostalgia playlist", "memory lane",
            "old school jams", "classic hits", "timeless songs",
            # Special
            "one hit wonders", "underrated songs", "hidden gems",
            "slept on songs", "deep cuts", "album cuts",
        ]
    },
}

# ============================================
# SUPABASE HELPER
# ============================================

def sync_to_supabase(tracks: List[Dict]) -> int:
    if not tracks:
        return 0
    data = []
    for t in tracks:
        if not t.get('youtube_id'):
            continue
        data.append({
            'youtube_id': t['youtube_id'],
            'title': t.get('title', 'Unknown')[:500],
            'artist': t.get('artist', 'Unknown')[:200],
            'thumbnail_url': t.get('thumbnail_url') or f"https://i.ytimg.com/vi/{t['youtube_id']}/hqdefault.jpg"
        })
    if not data:
        return 0
    try:
        req = urllib.request.Request(
            f'{SUPABASE_URL}/rest/v1/video_intelligence',
            data=json.dumps(data).encode('utf-8'),
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return len(data)
    except:
        return 0

def get_db_count() -> int:
    try:
        req = urllib.request.Request(
            f'{SUPABASE_URL}/rest/v1/video_intelligence?select=youtube_id&limit=1',
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Prefer': 'count=exact'
            }
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            count = resp.headers.get('content-range', '').split('/')[-1]
            return int(count) if count and count != '*' else 0
    except:
        return 0

# ============================================
# DOMAIN FEEDER
# ============================================

def feed_domain(domain_name: str, config: Dict) -> int:
    ytm = YTMusic()
    domain_synced = 0

    def get_thumb(thumbnails):
        if not thumbnails:
            return None
        sorted_t = sorted(thumbnails, key=lambda x: x.get('width', 0), reverse=True)
        return sorted_t[0].get('url') if sorted_t else None

    def is_new(video_id: str) -> bool:
        with seen_lock:
            if video_id in seen_ids:
                return False
            seen_ids.add(video_id)
            return True

    def extract_tracks(results: List, search_type: str = 'songs') -> List[Dict]:
        tracks = []
        for item in results:
            video_id = item.get('videoId')
            if video_id and is_new(video_id):
                artists = item.get('artists', [])
                artist_str = ', '.join([a.get('name', '') for a in artists if isinstance(a, dict)]) if artists else 'Unknown'
                tracks.append({
                    'youtube_id': video_id,
                    'title': item.get('title', 'Unknown'),
                    'artist': artist_str or 'Unknown',
                    'thumbnail_url': get_thumb(item.get('thumbnails', []))
                })
        return tracks

    pending = []
    print(f"\n🚀 [{domain_name}] Starting...")

    # Process artists
    for artist in config.get('artists', []):
        try:
            results = ytm.search(artist, filter='songs', limit=30)
            tracks = extract_tracks(results)
            pending.extend(tracks)

            results = ytm.search(artist, filter='videos', limit=15)
            tracks = extract_tracks(results, 'videos')
            pending.extend(tracks)

            if len(pending) >= 50:
                synced = sync_to_supabase(pending[:50])
                domain_synced += synced
                total_synced.add(synced)
                pending = pending[50:]

            time.sleep(random.uniform(0.2, 0.5))
        except:
            pass

    # Process queries
    for query in config.get('queries', []):
        try:
            results = ytm.search(query, filter='songs', limit=40)
            tracks = extract_tracks(results)
            pending.extend(tracks)

            results = ytm.search(query, filter='videos', limit=20)
            tracks = extract_tracks(results, 'videos')
            pending.extend(tracks)

            if len(pending) >= 50:
                synced = sync_to_supabase(pending[:50])
                domain_synced += synced
                total_synced.add(synced)
                pending = pending[50:]

            time.sleep(random.uniform(0.2, 0.4))
        except:
            pass

    # Final sync
    if pending:
        synced = sync_to_supabase(pending)
        domain_synced += synced
        total_synced.add(synced)

    total_discovered.add(domain_synced)
    print(f"✅ [{domain_name}] Done! Synced: {domain_synced:,}")
    return domain_synced


def run_ultimate(max_workers: int = 6):
    """Run the ultimate feeder"""
    print("=" * 70)
    print("  🌍 VOYO ULTIMATE FEEDER - Built by DASH & ZION 🌍")
    print("  THE WHOLE DIASPORA. THE WHOLE CULTURE. NO RESTRAINTS.")
    print("=" * 70)
    print()

    start_time = time.time()
    initial_count = get_db_count()

    print(f"📊 Initial database count: {initial_count:,} tracks")
    print(f"🧵 Parallel workers: {max_workers}")
    print(f"🌍 Domains: {len(ULTIMATE_DOMAINS)}")
    print()
    print("🚀 LAUNCHING ULTIMATE FEEDERS...")
    print("-" * 70)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(feed_domain, name, config): name
            for name, config in ULTIMATE_DOMAINS.items()
        }
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                print(f"❌ Error: {e}")

    elapsed = time.time() - start_time
    final_count = get_db_count()

    print()
    print("=" * 70)
    print("  🌍 ULTIMATE RESULTS 🌍")
    print("=" * 70)
    print(f"  Initial count:     {initial_count:,}")
    print(f"  Final count:       {final_count:,}")
    print(f"  NEW TRACKS:        +{final_count - initial_count:,}")
    print(f"  Total synced:      {total_synced.get():,}")
    print(f"  Time elapsed:      {elapsed:.1f}s ({elapsed/60:.1f} min)")
    print(f"  Rate:              {(final_count - initial_count) / max(elapsed/60, 1):.0f} tracks/min")
    print("=" * 70)
    print("  🔥 Built by DASH & ZION - THE WHOLE CULTURE 🔥")
    print("=" * 70)


if __name__ == '__main__':
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    run_ultimate(max_workers=workers)
