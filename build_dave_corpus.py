import os
import csv
import requests
import unicodedata
from collections import Counter

# Scripts that use morphology/structure incompatible with a naive character-level trigram
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

def main():
    os.makedirs("dicts", exist_ok=True)
    print("Querying GitHub for available languages...")
    
    # 1. Get the list of all language directories from the repository
    api_url = "https://api.github.com/repos/hermitdave/FrequencyWords/contents/content/2018"
    response = requests.get(api_url)
    
    if response.status_code != 200:
        print("Failed to reach GitHub API. Check connection or rate limits.")
        return
        
    folders = response.json()
    languages = [f["name"] for f in folders if f["type"] == "dir"]
    print(f"Discovered {len(languages)} total language datasets.")

    # 2. Process each language autonomously
    for lang in languages:
        # Prioritize the 'full' dataset, as many minority languages never reached 50k words
        urls_to_try = [
            f"https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/{lang}/{lang}_full.txt",
            f"https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/{lang}/{lang}_50k.txt"
        ]
        
        resp = None
        for url in urls_to_try:
            try:
                temp_resp = requests.get(url, timeout=15)
                if temp_resp.status_code == 200:
                    resp = temp_resp
                    break
            except Exception:
                continue
                
        if not resp:
            print(f"  [!] {lang}: Failed to download (Files missing or network error)")
            continue
            
        lines = resp.text.splitlines()
        if not lines:
            continue
            
        # 3. Detect the primary Unicode script for this specific language
        script_counts = Counter()
        for line in lines[:500]:
            word = line.split()[0] if line.split() else ""
            for char in word:
                script = get_char_script(char)
                if script and script not in {"SPACE", "DIGIT"}:
                    script_counts[script] += 1
                    
        if not script_counts:
            print(f"  [-] {lang}: Dropped (No valid characters detected)")
            continue
            
        primary_script = script_counts.most_common(1)[0][0]
        
        # 4. Exclude incompatible writing systems
        if primary_script in INVALID_SCRIPTS:
            print(f"  [-] {lang}: Dropped (Incompatible script: {primary_script})")
            continue
            
        print(f"  [+] {lang}: Detected {primary_script}. Processing...")
        
        cleaned_words = []
        
        # 5. Cleanse and extract top 10k words
        for line in lines:
            parts = line.split()
            if len(parts) >= 2:
                word = parts[0].strip()
                try:
                    count = int(parts[1].strip())
                except ValueError:
                    continue
                    
                # Exclude single letters and standardize length
                if len(word) < 2:
                    continue
                    
                is_valid = True
                for char in word:
                    script = get_char_script(char)
                    # The character must strictly match the language's detected script 
                    # OR be a valid Unicode combining diacritic (accents, macrons)
                    if script != primary_script and script != "COMBINING":
                        is_valid = False
                        break
                        
                if is_valid:
                    cleaned_words.append((word, count))
                    
                if len(cleaned_words) >= 10000:
                    break
                    
        # 6. Save the sanitized dictionary
        if cleaned_words:
            out_file = os.path.join("dicts", f"{lang}.csv")
            with open(out_file, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(["word", "count"])
                for w, c in cleaned_words:
                    writer.writerow([w, c])
            print(f"      -> Saved {len(cleaned_words)} valid words to {out_file}")

if __name__ == "__main__":
    main()