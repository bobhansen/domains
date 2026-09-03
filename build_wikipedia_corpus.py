import os
import csv
import requests
import unicodedata
from collections import Counter

# Scripts with morphology (root-and-pattern, floating vowels, pre-composed blocks) 
# that break naive character-level Markov trigram generation.
INVALID_SCRIPTS = {
    "ARABIC", "DEVANAGARI", "BENGALI", "THAI", "HEBREW", 
    "TAMIL", "TELUGU", "MALAYALAM", "SINHALA", "KHMER", 
    "MYANMAR", "HANGUL", "CJK", "HIRAGANA", "KATAKANA", "GUJARATI", "LAO"
}

def get_char_script(char):
    """Extracts the official Unicode block name for a character."""
    try:
        name = unicodedata.name(char)
        return name.split()[0]
    except ValueError:
        return None

def get_repo_files():
    """Fetches the file list from the Languages folder of the Wikipedia frequency repository."""
    print("Querying GitHub for available Wikipedia language datasets...")
    api_url = "https://api.github.com/repos/maximofcom/Most-Frequent-Words-In-323-Languages/contents/Languages"
    
    response = requests.get(api_url)
    if response.status_code != 200:
        print(f"Failed to reach GitHub API (Status: {response.status_code}). Check your connection or rate limits.")
        return []
        
    files = response.json()
    return [f["name"] for f in files if f["name"].startswith("freq_") and f["name"].endswith(".txt")]

def parse_line(line):
    """Dynamically splits the line whether it uses spaces, tabs, or commas."""
    # First try standard whitespace (spaces or tabs)
    parts = line.split()
    if len(parts) >= 2:
        return parts
    # Fallback for CSV format
    parts = line.split(',')
    if len(parts) >= 2:
        return parts
    return []

def main():
    output_dir = "wikipedia_dicts"
    os.makedirs(output_dir, exist_ok=True)
    
    files = get_repo_files()
    if not files:
        return
        
    print(f"Discovered {len(files)} language datasets. Beginning processing...")

    for filename in files:
        lang = filename.replace("freq_", "").replace(".txt", "")
        
        raw_url = f"https://raw.githubusercontent.com/maximofcom/Most-Frequent-Words-In-323-Languages/main/Languages/{filename}"
        
        try:
            resp = requests.get(raw_url, timeout=15)
            if resp.status_code == 404:
                raw_url = raw_url.replace("/main/", "/master/")
                resp = requests.get(raw_url, timeout=15)
                
            resp.raise_for_status()
        except Exception as e:
            print(f"  [!] {lang}: Failed to download ({e})")
            continue
            
        lines = resp.text.splitlines()
        if not lines:
            continue
            
        script_counts = Counter()
        for line in lines[:500]:
            parts = parse_line(line)
            word = parts[0].strip() if parts else ""
            for char in word:
                script = get_char_script(char)
                if script and script not in {"SPACE", "DIGIT", "PUNCTUATION"}:
                    script_counts[script] += 1
                    
        if not script_counts:
            print(f"  [-] {lang}: Dropped (No valid characters detected)")
            continue
            
        primary_script = script_counts.most_common(1)[0][0]
        
        if primary_script in INVALID_SCRIPTS:
            print(f"  [-] {lang}: Dropped (Incompatible script: {primary_script})")
            continue
            
        print(f"  [+] {lang}: Detected {primary_script}. Processing...")
        
        cleaned_words = []
        
        for line in lines:
            parts = parse_line(line)
            if len(parts) >= 2:
                word = parts[0].strip()
                try:
                    count = int(parts[1].strip())
                except ValueError:
                    continue
                    
                if len(word) < 2:
                    continue
                    
                is_valid = True
                for char in word:
                    script = get_char_script(char)
                    if script != primary_script and script != "COMBINING":
                        is_valid = False
                        break
                        
                if is_valid:
                    cleaned_words.append((word, count))
                    
                if len(cleaned_words) >= 10000:
                    break
                    
        if cleaned_words:
            out_file = os.path.join(output_dir, f"{lang}.csv")
            with open(out_file, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(["word", "count"])
                for w, c in cleaned_words:
                    writer.writerow([w, c])
            print(f"      -> Saved {len(cleaned_words)} valid words to {out_file}")
        else:
            print(f"      -> [!] Parsed 0 valid words for {lang}. Format might be irregular.")

if __name__ == "__main__":
    main()