# Conti di casa — PWA privata con Google OAuth

Questa versione elimina l’API key e non richiede che il foglio sia pubblico. La PWA è pubblicabile su GitHub Pages; ogni lettura dei dati richiede un token OAuth temporaneo dell’account Google che possiede o condivide il foglio.

## Prima del deploy

1. **Revoca/elimina la vecchia API key esposta** nel progetto Google Cloud e disattiva la condivisione “Chiunque abbia il link” del vecchio foglio.
2. Questa copia è già configurata con il Client ID e l’ID del foglio attuale. Prima del deploy, in **Condividi → Accesso generale** seleziona **Limitato** e condividi il foglio direttamente solo con i tuoi account Google (e quelli familiari strettamente necessari), usando “Visualizzatore” se la dashboard deve solo leggere. La scelta più prudente resta creare una copia nuova del foglio dopo aver chiuso l’accesso pubblico; se lo fai, sostituisci nel codice soltanto `spreadsheetId`.
3. In Google Cloud, seleziona il progetto che userai e abilita **Google Sheets API**.
4. Configura **Google Auth Platform**:
   - Branding: nome dell’app e email di supporto;
   - Audience: per uso personale/familiare va bene **External** in modalità test e aggiungi gli account effettivamente autorizzati come test users;
   - Data Access: aggiungi solo lo scope `https://www.googleapis.com/auth/spreadsheets.readonly`.
5. In **Clients → Create client → Web application**, aggiungi come **Authorized JavaScript origin**:
   - `https://gsravanetti.github.io`
   - aggiungi `http://localhost` soltanto se vuoi testare in locale con un server locale.
   Non inserire un percorso (`/FamilyExpenses`): qui serve l’origine, cioè schema + dominio + porta.
6. I valori in `GOOGLE_OAUTH_CONFIG` sono già inseriti. Se userai una nuova copia privata del foglio, modifica esclusivamente `spreadsheetId`. Non inserire mai un Client Secret o una API key.
7. Pubblica **tutti** i file di questa cartella alla radice del repository Pages (quindi `index.html`, `manifest.webmanifest`, `sw.js` e `icons/`).

## Uso su iPhone e Android

Apri l’URL in Safari (iPhone) o Chrome (Android), esegui il login e usa “Condividi → Aggiungi a Home” su iPhone oppure “Installa app”/“Aggiungi a schermata Home” su Android. La PWA conserva solo l’interfaccia statica per funzionare meglio offline; non conserva spese, token o risposte dell’API.

## Cosa aspettarsi dall’accesso continuativo

Il consenso Google resta associato al tuo account e al Client ID. I token di accesso, invece, sono volutamente brevi: Google richiede un nuovo token con un gesto dell’utente quando scadono. Di norma basta premere “Accedi con Google” o “Aggiorna dati” e, se l’account è ancora già connesso a Google, non occorre ridigitare password. Non esiste un token permanente sicuro da includere in una PWA statica.

## Verifica finale

- In una finestra anonima, l’URL della PWA non deve mostrare spese prima dell’accesso.
- Accedi con un account condiviso: la dashboard deve caricarsi.
- Accedi con un account non condiviso: deve ricevere un errore 403 e nessun dato.
- Cerca nel repository le stringhe `AIza`, `apiKey`, `Client Secret` e l’ID del vecchio foglio: non devono comparire.
- Controlla in Google Drive che “Accesso generale” del nuovo foglio sia **Limitato**.
