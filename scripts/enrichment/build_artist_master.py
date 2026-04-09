#!/usr/bin/env python3
"""
VOYO Enrichment Phase 1: Build Artist Master Database
=====================================================
Takes the existing artistTiers.ts and expands it into a comprehensive
artist database with tier, region, genre, and default vibe scores.

Usage:
    python scripts/enrichment/build_artist_master.py
    python scripts/enrichment/build_artist_master.py --expand  # Fetch from Supabase too
"""

import json
import os
import re
from typing import Dict, List, Optional

# ============================================
# GENRE -> VIBE SCORE DEFAULTS
# ============================================

GENRE_VIBE_DEFAULTS = {
    # Nigerian
    'afrobeats': {'afro_heat': 85, 'chill': 35, 'party': 75, 'workout': 70, 'late_night': 45},
    'afropop': {'afro_heat': 80, 'chill': 45, 'party': 70, 'workout': 60, 'late_night': 50},
    'afro-fusion': {'afro_heat': 70, 'chill': 55, 'party': 60, 'workout': 50, 'late_night': 65},
    'alte': {'afro_heat': 50, 'chill': 80, 'party': 40, 'workout': 30, 'late_night': 85},
    'fuji': {'afro_heat': 70, 'chill': 40, 'party': 80, 'workout': 50, 'late_night': 45},
    'juju': {'afro_heat': 60, 'chill': 55, 'party': 70, 'workout': 40, 'late_night': 50},

    # South African
    'amapiano': {'afro_heat': 70, 'chill': 50, 'party': 90, 'workout': 60, 'late_night': 80},
    'gqom': {'afro_heat': 90, 'chill': 10, 'party': 95, 'workout': 85, 'late_night': 70},
    'kwaito': {'afro_heat': 65, 'chill': 55, 'party': 75, 'workout': 50, 'late_night': 65},
    'maskandi': {'afro_heat': 50, 'chill': 60, 'party': 55, 'workout': 40, 'late_night': 45},
    'sa-house': {'afro_heat': 75, 'chill': 40, 'party': 85, 'workout': 70, 'late_night': 75},

    # East African
    'bongo-flava': {'afro_heat': 75, 'chill': 45, 'party': 70, 'workout': 55, 'late_night': 50},
    'gengetone': {'afro_heat': 80, 'chill': 20, 'party': 85, 'workout': 70, 'late_night': 60},
    'benga': {'afro_heat': 60, 'chill': 50, 'party': 65, 'workout': 45, 'late_night': 40},
    'taarab': {'afro_heat': 30, 'chill': 75, 'party': 40, 'workout': 20, 'late_night': 70},

    # Central African
    'ndombolo': {'afro_heat': 80, 'chill': 20, 'party': 90, 'workout': 70, 'late_night': 60},
    'soukous': {'afro_heat': 75, 'chill': 35, 'party': 85, 'workout': 60, 'late_night': 55},
    'rumba': {'afro_heat': 50, 'chill': 75, 'party': 60, 'workout': 30, 'late_night': 80},
    'makossa': {'afro_heat': 70, 'chill': 40, 'party': 80, 'workout': 55, 'late_night': 50},

    # West African (Non-Nigerian)
    'highlife': {'afro_heat': 60, 'chill': 70, 'party': 65, 'workout': 40, 'late_night': 55},
    'hiplife': {'afro_heat': 70, 'chill': 45, 'party': 75, 'workout': 55, 'late_night': 50},
    'azonto': {'afro_heat': 85, 'chill': 20, 'party': 90, 'workout': 75, 'late_night': 55},
    'mbalax': {'afro_heat': 75, 'chill': 30, 'party': 80, 'workout': 65, 'late_night': 40},
    'coupe-decale': {'afro_heat': 85, 'chill': 15, 'party': 95, 'workout': 70, 'late_night': 60},

    # General African
    'afro-house': {'afro_heat': 65, 'chill': 40, 'party': 85, 'workout': 75, 'late_night': 70},
    'afro-soul': {'afro_heat': 40, 'chill': 85, 'party': 30, 'workout': 20, 'late_night': 75},
    'afro-rnb': {'afro_heat': 45, 'chill': 80, 'party': 35, 'workout': 25, 'late_night': 80},
    'african-gospel': {'afro_heat': 30, 'chill': 70, 'party': 40, 'workout': 35, 'late_night': 25},

    # Diaspora
    'reggae': {'afro_heat': 40, 'chill': 85, 'party': 50, 'workout': 30, 'late_night': 70},
    'dancehall': {'afro_heat': 75, 'chill': 25, 'party': 90, 'workout': 70, 'late_night': 65},
    'hip-hop': {'afro_heat': 70, 'chill': 40, 'party': 65, 'workout': 80, 'late_night': 55},
    'rnb': {'afro_heat': 35, 'chill': 80, 'party': 40, 'workout': 25, 'late_night': 85},
    'neo-soul': {'afro_heat': 30, 'chill': 90, 'party': 25, 'workout': 20, 'late_night': 80},
    'gospel': {'afro_heat': 35, 'chill': 65, 'party': 45, 'workout': 40, 'late_night': 30},
    'zouk': {'afro_heat': 55, 'chill': 65, 'party': 70, 'workout': 35, 'late_night': 80},
    'kompa': {'afro_heat': 50, 'chill': 70, 'party': 65, 'workout': 30, 'late_night': 75},

    # Default fallback
    'unknown': {'afro_heat': 50, 'chill': 50, 'party': 50, 'workout': 50, 'late_night': 50},
}

# ============================================
# TIER A ARTISTS (Global Icons)
# From existing artistTiers.ts
# ============================================

TIER_A_ARTISTS = {
    # Nigeria
    'burna boy': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2010s', '2020s']},
    'wizkid': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2010s', '2020s']},
    'davido': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2010s', '2020s']},
    'rema': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2020s']},
    'asake': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'amapiano', 'era_active': ['2020s']},
    'tems': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afro-soul', 'era_active': ['2020s']},
    'ckay': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2020s']},
    'ayra starr': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2020s']},
    'fela kuti': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['1970s', '1980s', '1990s']},
    'kizz daniel': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2010s', '2020s']},
    'omah lay': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afro-fusion', 'era_active': ['2020s']},
    'fireboy dml': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2020s']},
    'olamide': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2010s', '2020s']},
    'tiwa savage': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2010s', '2020s']},
    'yemi alade': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2010s', '2020s']},
    'ruger': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2020s']},
    'p square': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2000s', '2010s']},
    'dbanj': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2000s', '2010s']},
    '2baba': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2000s', '2010s', '2020s']},

    # South Africa
    'black coffee': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'afro-house', 'era_active': ['2010s', '2020s']},
    'tyla': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'amapiano', 'era_active': ['2020s']},
    'kabza de small': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'amapiano', 'era_active': ['2020s']},
    'dj maphorisa': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'amapiano', 'era_active': ['2010s', '2020s']},
    'master kg': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'sa-house', 'era_active': ['2020s']},
    'nasty c': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},
    'focalistic': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'amapiano', 'era_active': ['2020s']},
    'uncle waffles': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'amapiano', 'era_active': ['2020s']},

    # Ghana
    'black sherif': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2020s']},
    'sarkodie': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'hiplife', 'era_active': ['2010s', '2020s']},
    'stonebwoy': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'reggae', 'era_active': ['2010s', '2020s']},
    'shatta wale': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'dancehall', 'era_active': ['2010s', '2020s']},
    'king promise': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2020s']},
    'kidi': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'highlife', 'era_active': ['2020s']},
    'kuami eugene': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'highlife', 'era_active': ['2020s']},

    # Tanzania
    'diamond platnumz': {'country': 'TZ', 'region': 'east-africa', 'primary_genre': 'bongo-flava', 'era_active': ['2010s', '2020s']},
    'harmonize': {'country': 'TZ', 'region': 'east-africa', 'primary_genre': 'bongo-flava', 'era_active': ['2010s', '2020s']},
    'rayvanny': {'country': 'TZ', 'region': 'east-africa', 'primary_genre': 'bongo-flava', 'era_active': ['2010s', '2020s']},
    'zuchu': {'country': 'TZ', 'region': 'east-africa', 'primary_genre': 'bongo-flava', 'era_active': ['2020s']},
    'ali kiba': {'country': 'TZ', 'region': 'east-africa', 'primary_genre': 'bongo-flava', 'era_active': ['2000s', '2010s', '2020s']},

    # DRC
    'fally ipupa': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'ndombolo', 'era_active': ['2000s', '2010s', '2020s']},
    'koffi olomide': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'soukous', 'era_active': ['1980s', '1990s', '2000s', '2010s']},
    'innossb': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'afrobeats', 'era_active': ['2020s']},
    'gims': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},
    'dadju': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'rnb', 'era_active': ['2010s', '2020s']},
    'papa wemba': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'rumba', 'era_active': ['1970s', '1980s', '1990s', '2000s']},

    # Guinea
    'saifond balde': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2020s']},
    'azaya': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2010s', '2020s']},
    'sekouba bambino': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'highlife', 'era_active': ['1990s', '2000s']},
    'mory kante': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'highlife', 'era_active': ['1980s', '1990s']},
    'soul bangs': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'reggae', 'era_active': ['2010s', '2020s']},
    'djanii alfa': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2010s', '2020s']},
    'instinct killers': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},
    'straiker': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2020s']},
    'king alasko': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2010s', '2020s']},

    # Senegal
    'youssou ndour': {'country': 'SN', 'region': 'west-africa', 'primary_genre': 'mbalax', 'era_active': ['1980s', '1990s', '2000s', '2010s']},
    'akon': {'country': 'SN', 'region': 'west-africa', 'primary_genre': 'rnb', 'era_active': ['2000s', '2010s']},
    'wally seck': {'country': 'SN', 'region': 'west-africa', 'primary_genre': 'mbalax', 'era_active': ['2010s', '2020s']},

    # Ivory Coast
    'dj arafat': {'country': 'CI', 'region': 'west-africa', 'primary_genre': 'coupe-decale', 'era_active': ['2000s', '2010s']},
    'magic system': {'country': 'CI', 'region': 'west-africa', 'primary_genre': 'coupe-decale', 'era_active': ['2000s', '2010s']},
    'alpha blondy': {'country': 'CI', 'region': 'west-africa', 'primary_genre': 'reggae', 'era_active': ['1980s', '1990s', '2000s']},

    # Kenya
    'sauti sol': {'country': 'KE', 'region': 'east-africa', 'primary_genre': 'afropop', 'era_active': ['2010s', '2020s']},
    'nyashinski': {'country': 'KE', 'region': 'east-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},

    # Mali
    'salif keita': {'country': 'ML', 'region': 'west-africa', 'primary_genre': 'highlife', 'era_active': ['1980s', '1990s', '2000s']},
    'amadou mariam': {'country': 'ML', 'region': 'west-africa', 'primary_genre': 'highlife', 'era_active': ['2000s', '2010s']},

    # Ethiopia
    'teddy afro': {'country': 'ET', 'region': 'east-africa', 'primary_genre': 'afropop', 'era_active': ['2000s', '2010s', '2020s']},
}

# ============================================
# TIER B ARTISTS (Regional Stars)
# ============================================

TIER_B_ARTISTS = {
    # Nigeria B
    'adekunle gold': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afro-soul', 'era_active': ['2010s', '2020s']},
    'simi': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afro-soul', 'era_active': ['2010s', '2020s']},
    'wande coal': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2000s', '2010s', '2020s']},
    'flavour': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'highlife', 'era_active': ['2010s', '2020s']},
    'tekno': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2010s', '2020s']},
    'phyno': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},
    'zlatan': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2010s', '2020s']},
    'mr eazi': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2010s', '2020s']},
    'joeboy': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2020s']},
    'bnxn': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2020s']},
    'victony': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afro-fusion', 'era_active': ['2020s']},
    'pheelz': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2020s']},
    'bella shmurda': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2020s']},
    'seyi vibez': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2020s']},
    'oxlade': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afro-fusion', 'era_active': ['2020s']},
    'mayorkun': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2010s', '2020s']},
    'falz': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},
    'patoranking': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'dancehall', 'era_active': ['2010s', '2020s']},
    'timaya': {'country': 'NG', 'region': 'west-africa', 'primary_genre': 'dancehall', 'era_active': ['2000s', '2010s', '2020s']},

    # South Africa B
    'young stunna': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'amapiano', 'era_active': ['2020s']},
    'dbn gogo': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'amapiano', 'era_active': ['2020s']},
    'cassper nyovest': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},
    'makhadzi': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'sa-house', 'era_active': ['2020s']},
    'a reece': {'country': 'ZA', 'region': 'south-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},

    # Guinea B
    'takana zion': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'reggae', 'era_active': ['2010s', '2020s']},
    'mamady keita': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'highlife', 'era_active': ['1990s', '2000s']},
    'koury simple': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2020s']},
    'bembeya jazz': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'highlife', 'era_active': ['1960s', '1970s', '1980s']},
    'mc freshh': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2020s']},
    'thiird': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2020s']},
    'maxim bk': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2010s', '2020s']},
    'wada du game': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2020s']},
    'hezbo rap': {'country': 'GN', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2020s']},

    # Tanzania B
    'nandy': {'country': 'TZ', 'region': 'east-africa', 'primary_genre': 'bongo-flava', 'era_active': ['2010s', '2020s']},
    'mbosso': {'country': 'TZ', 'region': 'east-africa', 'primary_genre': 'bongo-flava', 'era_active': ['2020s']},
    'marioo': {'country': 'TZ', 'region': 'east-africa', 'primary_genre': 'bongo-flava', 'era_active': ['2020s']},

    # DRC B
    'ferre gola': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'ndombolo', 'era_active': ['2000s', '2010s', '2020s']},
    'heritier watanabe': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'ndombolo', 'era_active': ['2010s', '2020s']},
    'werrason': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'ndombolo', 'era_active': ['1990s', '2000s', '2010s']},
    'aya nakamura': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'rnb', 'era_active': ['2010s', '2020s']},
    'damso': {'country': 'CD', 'region': 'central-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},

    # Ghana B
    'gyakie': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'afropop', 'era_active': ['2020s']},
    'camidoh': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'afrobeats', 'era_active': ['2020s']},
    'medikal': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},
    'kwesi arthur': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'hip-hop', 'era_active': ['2010s', '2020s']},
    'r2bees': {'country': 'GH', 'region': 'west-africa', 'primary_genre': 'hiplife', 'era_active': ['2010s', '2020s']},
}

# ============================================
# ARTIST ALIASES
# ============================================

ALIASES = {
    'burnaboy': 'burna boy',
    'wiz kid': 'wizkid',
    'starboy': 'wizkid',
    'obo': 'davido',
    'fela': 'fela kuti',
    'diamond': 'diamond platnumz',
    'blackcoffee': 'black coffee',
    'psquare': 'p square',
    'p-square': 'p square',
    'innoss b': 'innossb',
    "innoss'b": 'innossb',
    'youssou n dour': 'youssou ndour',
    "youssou n'dour": 'youssou ndour',
    'mory kante': 'mory kante',
    'sekouba': 'sekouba bambino',
    'bambino': 'sekouba bambino',
    'maitre gims': 'gims',
    'maitre gim': 'gims',
    'dj khaled': 'khaled',
    'buju bnxn': 'bnxn',
    'buju': 'bnxn',
}

# ============================================
# CULTURAL ICONS (High significance regardless of streams)
# ============================================

CULTURAL_ICONS = {
    'fela kuti': {'historical': 5, 'social': 5, 'diasporic': 5, 'preservational': 5, 'tags': ['revolution', 'protest', 'liberation', 'pan-african']},
    'miriam makeba': {'historical': 5, 'social': 5, 'diasporic': 5, 'preservational': 4, 'tags': ['liberation', 'anthem', 'pan-african']},
    'bob marley': {'historical': 5, 'social': 5, 'diasporic': 5, 'preservational': 4, 'tags': ['liberation', 'spiritual', 'pan-african']},
    'youssou ndour': {'historical': 4, 'social': 4, 'diasporic': 4, 'preservational': 5, 'tags': ['tradition', 'roots', 'motherland']},
    'salif keita': {'historical': 4, 'social': 3, 'diasporic': 4, 'preservational': 5, 'tags': ['tradition', 'roots']},
    'papa wemba': {'historical': 4, 'social': 3, 'diasporic': 4, 'preservational': 5, 'tags': ['tradition', 'roots']},
    'bembeya jazz': {'historical': 5, 'social': 5, 'diasporic': 3, 'preservational': 5, 'tags': ['liberation', 'tradition', 'pan-african']},
    'angelique kidjo': {'historical': 4, 'social': 4, 'diasporic': 5, 'preservational': 4, 'tags': ['diaspora', 'bridge', 'pan-african']},
    'hugh masekela': {'historical': 5, 'social': 5, 'diasporic': 4, 'preservational': 4, 'tags': ['liberation', 'protest']},
    'alpha blondy': {'historical': 4, 'social': 4, 'diasporic': 3, 'preservational': 3, 'tags': ['spiritual', 'liberation']},
    'mory kante': {'historical': 4, 'social': 3, 'diasporic': 4, 'preservational': 4, 'tags': ['tradition', 'bridge']},
}

# ============================================
# BUILD MASTER DATABASE
# ============================================

def normalize_name(name: str) -> str:
    """Normalize artist name for lookup."""
    normalized = name.lower()
    normalized = re.sub(r'[^\w\s]', '', normalized)
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    return normalized

def build_artist_master() -> Dict:
    """Build the complete artist master database."""
    master = {}

    # Add A-tier artists
    for artist, info in TIER_A_ARTISTS.items():
        genre = info.get('primary_genre', 'afrobeats')
        vibe_scores = GENRE_VIBE_DEFAULTS.get(genre, GENRE_VIBE_DEFAULTS['unknown'])

        # Get cultural scores if icon
        cultural_scores = CULTURAL_ICONS.get(artist, {})
        cultural_tags = cultural_scores.get('tags', [])

        master[artist] = {
            'canonical_name': artist.title(),
            'normalized_name': normalize_name(artist),
            'tier': 'A',
            'country': info.get('country', 'XX'),
            'region': info.get('region', 'unknown'),
            'primary_genre': genre,
            'era_active': info.get('era_active', ['2020s']),
            'default_vibe_scores': vibe_scores.copy(),
            'cultural_significance': {
                'historical': cultural_scores.get('historical', 3),
                'social': cultural_scores.get('social', 3),
                'diasporic': cultural_scores.get('diasporic', 3),
                'preservational': cultural_scores.get('preservational', 2),
            },
            'default_cultural_tags': cultural_tags,
            'default_aesthetic_tags': ['influential', 'production'],
        }

    # Add B-tier artists
    for artist, info in TIER_B_ARTISTS.items():
        genre = info.get('primary_genre', 'afrobeats')
        vibe_scores = GENRE_VIBE_DEFAULTS.get(genre, GENRE_VIBE_DEFAULTS['unknown'])

        master[artist] = {
            'canonical_name': artist.title(),
            'normalized_name': normalize_name(artist),
            'tier': 'B',
            'country': info.get('country', 'XX'),
            'region': info.get('region', 'unknown'),
            'primary_genre': genre,
            'era_active': info.get('era_active', ['2020s']),
            'default_vibe_scores': vibe_scores.copy(),
            'cultural_significance': {
                'historical': 2,
                'social': 2,
                'diasporic': 2,
                'preservational': 1,
            },
            'default_cultural_tags': [],
            'default_aesthetic_tags': ['production'],
        }

    # Add aliases
    for alias, canonical in ALIASES.items():
        if canonical in master:
            master[alias] = master[canonical].copy()
            master[alias]['is_alias'] = True
            master[alias]['alias_of'] = canonical

    return master

def save_artist_master(master: Dict, output_path: str = 'data/artist_master.json'):
    """Save artist master to JSON file."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, 'w') as f:
        json.dump({
            'version': '1.0',
            'total_artists': len([a for a in master.values() if not a.get('is_alias')]),
            'total_with_aliases': len(master),
            'tier_breakdown': {
                'A': len([a for a in master.values() if a.get('tier') == 'A' and not a.get('is_alias')]),
                'B': len([a for a in master.values() if a.get('tier') == 'B' and not a.get('is_alias')]),
            },
            'artists': master
        }, f, indent=2)

    print(f"Saved artist master to {output_path}")

def save_genre_vibes(output_path: str = 'data/genre_vibe_defaults.json'):
    """Save genre vibe defaults to JSON file."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, 'w') as f:
        json.dump(GENRE_VIBE_DEFAULTS, f, indent=2)

    print(f"Saved genre vibe defaults to {output_path}")

# ============================================
# MAIN
# ============================================

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Build VOYO Artist Master Database')
    parser.add_argument('--output', default='data/artist_master.json', help='Output path')
    parser.add_argument('--expand', action='store_true', help='Expand with Supabase top artists')

    args = parser.parse_args()

    print("=" * 60)
    print("VOYO Artist Master Database Builder")
    print("=" * 60)
    print()

    master = build_artist_master()

    # Stats
    a_count = len([a for a in master.values() if a.get('tier') == 'A' and not a.get('is_alias')])
    b_count = len([a for a in master.values() if a.get('tier') == 'B' and not a.get('is_alias')])
    alias_count = len([a for a in master.values() if a.get('is_alias')])

    print(f"A-Tier Artists: {a_count}")
    print(f"B-Tier Artists: {b_count}")
    print(f"Aliases: {alias_count}")
    print(f"Total Entries: {len(master)}")
    print()

    # Save
    save_artist_master(master, args.output)
    save_genre_vibes()

    print()
    print("Done!")
