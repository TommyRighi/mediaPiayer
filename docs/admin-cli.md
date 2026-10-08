# Console admin via SSH

La console è una CLI in italiano, con menu numerati. Non richiede il browser né
il server web per configurare l'app, gestire utenti e inviti o fare backup.
Scansioni e torrent usano invece il server attivo, così il suo scheduler continua
a dare priorità alla riproduzione.

## Avvio

Dopo avere installato Node.js 24, Git e clonato il repository:

```bash
cd mediaPiayer
npm run admin
```

Il menu iniziale funziona anche prima di `npm install` e senza `.env`.
Le operazioni sul database richiedono le dipendenze backend.
Per una connessione SSH che esegue direttamente il menu:

```bash
ssh -t pi@raspberry 'cd /percorso/mediaPiayer && ./ssh-menu.sh'
```

`0` torna indietro o esce alla shell. Invio usa il valore proposto. Le azioni che
cambiano configurazione, accessi o servizi chiedono `SI`; il ripristino chiede
`RIPRISTINA`. Le password inserite non vengono mostrate durante la digitazione.

## Primo setup

1. Apri **Setup → Configurazione guidata**. Imposta porta, indirizzo, origine
   HTTPS, cartelle media e database. La console genera un segreto JWT quando
   manca o è un placeholder e conserva quello valido già esistente. Il file
   viene scritto atomicamente con permessi `600`.
2. Installa gli strumenti Linux e ffmpeg dal menu, se necessari. È richiesto sudo.
3. Installa dipendenze e compila dal menu. Vengono eseguiti `npm ci` nel backend
   e nel frontend, poi `npm run build`.
4. Crea il primo amministratore. La password casuale viene mostrata nel terminale;
   copiala e cambiala al primo accesso. Gli inviti monouso creano solo viewer.
5. Installa il servizio automatico. La console crea un servizio **systemd utente**,
   collegato ai percorsi effettivi del repository, del file env e di Node.
   L'opzione linger permette l'avvio al boot senza una sessione SSH aperta.
6. Se usi Tailscale, installalo sul Pi; il menu permette il login, mostra lo stato e permette
   di attivare Serve. Copia l'origine HTTPS mostrata in Configurazione e riavvia
   MediaPiayer. Serve è documentato nella [CLI ufficiale Tailscale](https://tailscale.com/docs/reference/tailscale-cli/serve).
7. Copia i contenuti nelle cartelle `movies`, `series`, `music`, `posters`, avvia
   il servizio e usa **Libreria → Scansiona**.

La console non installa o cambia automaticamente Node, il sistema operativo,
la policy Tailscale o le regole del router. Gli strumenti non disponibili vengono
segnalati da Stato e diagnostica.

## Configurazione già esistente

```bash
npm run admin -- --env /percorso/config.env
npm run admin -- --status
npm run admin -- --env /percorso/config.env --status
```

Se esistono `/etc/mediapiayer.env` e il servizio di sistema del progetto, quel file
viene selezionato automaticamente. Per un env leggibile solo da root usa:

```bash
sudo /usr/bin/node scripts/admin.js --env /etc/mediapiayer.env
```

Per un servizio di sistema con utente dedicato, le operazioni sul database vengono
eseguite con quell'utente; la configurazione passa attraverso stdin, senza mettere
segreti negli argomenti. La console gestisce il servizio esistente e non lo
sostituisce con quello utente. Per installare i servizi utente nuovi usa il tuo
account SSH normale, non root.

Il controllo dell'accesso alla CLI dipende dall'account Linux e dalle autorizzazioni
SSH. I viewer dell'app non ricevono accesso al terminale e non possono usare le
API di download. La console non aggiunge un secondo login dell'app dentro SSH.

## Torrent

**Download torrent → Installa e configura demone Linux** installa Transmission
con apt e prepara un servizio utente dedicato, configurazione privata, credenziali
casuali e RPC su localhost. Se il demone di sistema occupa già la porta, la console
chiede prima di fermarlo e disabilitarlo. Il processo usa l'account SSH; scegli una
cartella accessibile anche all'account che esegue MediaPiayer.

Puoi anche collegare un demone esistente tramite **Configura Transmission**.
Riavvia MediaPiayer dopo le modifiche alla configurazione e abilita i download
nel menu Funzioni. Per aggiungere un film servono titolo e magnet. Play diventa
possibile dopo download completo, importazione ed eventuale conversione.

## Backup e aggiornamenti

Il backup usa l'API SQLite per includere anche le scritture WAL, mentre il server
è attivo. Salva database e configurazione in `data/admin-backups`, con permessi
privati. `ADMIN_BACKUP_DIR` nel file env permette di scegliere un altro disco.
I video, la musica e le immagini non sono inclusi: vanno copiati separatamente.

Il ripristino ferma il servizio scelto, verifica che il server non risponda più,
valida il database, salva quello precedente e ripristina solo il database.
Le sessioni vengono revocate. Env e file media restano quelli attuali; dopo il
ripristino riavvia il servizio dal menu.

**Aggiorna da GitHub** richiede un repository senza modifiche locali, crea un
backup, esegue `git pull --ff-only`, reinstalla e compila. Il riavvio viene proposto
solo dopo una build riuscita. Se un passaggio fallisce, l'operazione si ferma senza
fare reset del repository o cancellare modifiche locali.

## Apertura automatica quando entri via SSH

```bash
./setup-ssh-menu.sh --install-shell-hook
```

Questo aggiunge un blocco a `.bashrc` solo per sessioni SSH interattive con TTY,
con una copia di backup. Non interferisce con SCP o comandi SSH non interattivi.
Per rimuoverlo:

```bash
./setup-ssh-menu.sh --uninstall-shell-hook
```

L'apertura automatica è facoltativa. Senza queste opzioni, lo script non modifica
il profilo della shell. `--shell-file /percorso/bashrc` seleziona un altro file Bash.
