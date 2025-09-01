Voici la version **synthétique** de l’appel à **api-translate-rt** :

---

### 1) `/upload`

* **Méthode**: `POST multipart/form-data`
* **Champs** :

  * `file` = chunk audio (webm/ogg opus)
  * `target_lang` = langue cible (`#langSelect`)
  * `primary_lang` = langue principale (`#primaryLangSelect`)
* **Réponse attendue (JSON)** :

  ```json
  {
    "diarization": { "identifier": "xxxx", "noise": false },
    "transcription": "Texte reconnu",
    "translation_fr": "Texte traduit"
  }
  ```
* Sert à afficher texte + traduction et gérer la diarisation.

---

### 2) `/tts-proxy`

* **Méthode**: `POST application/json`
* **Headers**: `Authorization: Bearer <token>` (si requis)
* **Body** :

  ```json
  {
    "model": "gpt-4o-mini-tts",
    "input": "Texte à dire",
    "voice": "alloy",
    "instructions": "Speak in a cheerful and positive tone.",
    "response_format": "opus"
  }
  ```
* **Réponse** : flux audio (opus/ogg) joué par le navigateur.

---

👉 En résumé :

* `/upload` → audio in → JSON (transcription + traduction).
* `/tts-proxy` → texte in → audio out.
