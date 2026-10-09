# Aggiornamenti automatici del Raspberry

Il workflow `Raspberry deploy` parte a ogni push su `main` e può essere lanciato
manualmente dalla scheda Actions. GitHub installa le dipendenze, esegue lint e test,
compila il frontend e conserva un archivio della versione per sette giorni.
Il job di deploy si attiva quando la variabile `AUTO_DEPLOY_ENABLED` vale `true`.

La connessione usa l'azione ufficiale Tailscale e OpenSSH con una chiave dedicata.
Il Raspberry riceve codice e frontend già compilato; installa soltanto le
dipendenze backend, comprese quelle native per la propria architettura.
Le versioni vengono preparate in `.deploy/releases` nel checkout originale.
Il servizio punta al collegamento `.deploy/current`. I percorsi del database,
della configurazione e dei media vengono mantenuti tramite collegamenti.

## Preparazione del Raspberry, una volta sola

Servono Linux con systemd, Node 20.19 o successivo, npm, tar, flock, OpenSSH e Tailscale. La versione
attuale deve essere compilata, funzionante e avviata dal servizio systemd.
`NODE_ENV=production`, `PUBLIC_ORIGIN`, `HOST=127.0.0.1` e l'eventuale porta devono
essere nel file env usato dal servizio. Le dipendenze native richiedono gli stessi
strumenti di compilazione dell'installazione normale. Mantieni il servizio attivo
durante la preparazione. Gli aggiornamenti comportano un breve riavvio e
interrompono le riproduzioni in corso.

Aggiorna una volta il checkout per ottenere gli script nuovi. Esegui il setup
come lo stesso utente che esegue il servizio e che userai per SSH dal workflow.
Per il servizio utente creato dalla console di amministrazione:

```bash
cd /percorso/mediaPiayer
git pull --ff-only
node scripts/deploy-release.js setup --root "$PWD" --env-file "$PWD/.env" --mode user
```

Il setup crea un override del servizio `mediapiayer.service`, salva la versione
iniziale e verifica il riavvio. Stampa percorso del progetto, binario Node e
utente SSH da inserire nelle variabili GitHub. Usa Node 20.19 o successivo anche per questo comando.
`--npm /percorso/npm` seleziona npm quando non si trova accanto a Node.
Se necessario, abilita la permanenza del servizio utente con
`sudo loginctl enable-linger "$USER"`.

Per il servizio di sistema con env in `/etc/mediapiayer.env`:

```bash
sudo -v
node scripts/deploy-release.js setup --root /opt/mediapiayer --env-file /etc/mediapiayer.env --mode system
```

L'utente SSH deve coincidere con `User=` del servizio, avere accesso in scrittura
alla directory dell'app e del database, e poter leggere il file env. Il setup di
sistema usa sudo per installare l'override e ricaricare systemd. Per i deploy
successivi autorizza tramite `visudo` solo questi comandi, sostituendo l'utente:

```sudoers
mediapiayer ALL=(root) NOPASSWD: /usr/bin/systemctl start mediapiayer.service, /usr/bin/systemctl stop mediapiayer.service, /usr/bin/systemctl restart mediapiayer.service
```

Disattiva eventuali timer o cron che invocano `scripts/deploy-watcher.sh`. Dopo il
setup, gli aggiornamenti passano da GitHub Actions. La console impedisce il proprio
aggiornamento manuale quando trova `.deploy/config.json`. Non reinstallare le
dipendenze nel checkout iniziale: la versione bootstrap le usa per il rollback.

## Accesso nella tailnet

Assegna al Raspberry `tag:mediapiayer-server` e definisci `tag:mediapiayer-ci`.
Aggiungi queste voci alla policy esistente, conservando le altre regole:

```json
{
  "tagOwners": {
    "tag:mediapiayer-ci": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:mediapiayer-ci"],
      "dst": ["tag:mediapiayer-server"],
      "ip": ["tcp:22"]
    }
  ]
}
```

Configura un client Tailscale con scope `auth_keys` e tag `tag:mediapiayer-ci`.
Il workflow supporta la federazione OIDC con Client ID e Audience, oppure un
client OAuth con Client ID e Secret. Per OIDC limita l'identità al repository
`TommyRighi/mediaPiayer` e al branch `refs/heads/main`.
Segui le istruzioni ufficiali per [federazione OIDC](https://tailscale.com/docs/features/workload-identity-federation)
o [client OAuth](https://tailscale.com/docs/features/oauth-clients).

Il workflow usa il server OpenSSH del Raspberry sulla porta 22 attraverso
Tailscale. Se la porta è gestita dalla funzione Tailscale SSH, configura un
endpoint OpenSSH adatto a questo accesso con chiave prima di abilitare il deploy.

## Impostazioni GitHub

In **Settings → Secrets and variables → Actions**, aggiungi queste variabili:

| Variabile | Valore |
| --- | --- |
| `RPI_HOST` | IPv4 Tailscale o hostname MagicDNS del Raspberry, senza schema o porta |
| `RPI_SSH_USER` | Utente del servizio sul Raspberry |
| `RPI_DEPLOY_ROOT` | Percorso assoluto del checkout, stampato dal setup |
| `RPI_NODE_PATH` | Percorso assoluto di Node 20.19 o successivo, stampato dal setup |
| `AUTO_DEPLOY_ENABLED` | `true`, dopo avere completato configurazione e accesso |

Aggiungi i Secrets seguenti. Non inserire chiavi private nei file del repository.

| Secret | Valore |
| --- | --- |
| `TS_OAUTH_CLIENT_ID` | Client ID Tailscale, anche per OIDC |
| `TS_AUDIENCE` | Audience del client OIDC; lascia assente `TS_OAUTH_SECRET` |
| `TS_OAUTH_SECRET` | Secret del client OAuth; lascia assente `TS_AUDIENCE` |
| `RPI_SSH_KEY` | Chiave privata SSH dedicata al deploy, senza passphrase |
| `RPI_KNOWN_HOSTS` | Riga known_hosts del Raspberry con il valore esatto di `RPI_HOST` |

Genera la chiave su un computer amministrativo e aggiungi la chiave pubblica a
`~/.ssh/authorized_keys` dell'utente sul Raspberry:

```bash
ssh-keygen -t ed25519 -N '' -f ./mediapiayer-deploy-key
```

Puoi anteporre `restrict` alla chiave pubblica in authorized_keys per disabilitare
TTY e forwarding. Serve comunque l'esecuzione di comandi e il sottosistema SFTP
usato da SCP. Verifica la chiave host tramite una connessione amministrativa
già attendibile; sul Raspberry trovi quella pubblica in
`/etc/ssh/ssh_host_ed25519_key.pub`. Per `RPI_KNOWN_HOSTS` usa il formato:

```text
raspberry.nome-tailnet.ts.net ssh-ed25519 AAAA...chiave-pubblica-host...
```

L'accesso verifica la chiave host e non usa acquisizione automatica durante il
deploy. L'azione Tailscale crea un nodo temporaneo e lo rimuove al termine.
[Documentazione dell'azione](https://tailscale.com/docs/integrations/github/github-action).

## Primo deploy e gestione degli errori

Attiva `AUTO_DEPLOY_ENABLED`, apri **Actions → Raspberry deploy → Run workflow**
e scegli `main`. I push successivi avvieranno il processo automaticamente.
Le esecuzioni vengono serializzate; un lock sul Raspberry impedisce installazioni
concorrenti. Il controllo dell'ID del workflow rifiuta deploy più vecchi di uno
già riuscito. Checksum e commit devono corrispondere all'archivio trasferito.

Finché dipendenze e frontend non passano i controlli, il servizio esistente
rimane attivo. Poi il deploy ferma il servizio, salva un backup SQLite con WAL,
attiva la versione e controlla `/api/auth/config` per un massimo di 30 secondi.
Un errore di avvio ripristina versione e database precedenti. Eventuali scritture
avvenute nei pochi secondi di avvio della versione fallita vengono perse con
quel ripristino. I file multimediali non vengono ripristinati o cancellati.

I backup restano in `.deploy/backups`, le versioni in `.deploy/releases` e l'ultimo
deploy riuscito in `.deploy/status.json`. Non vengono cancellati automaticamente:
controlla lo spazio libero e conserva versione corrente, precedente, bootstrap
e backup utili. Un errore di rollback richiede intervento manuale; il workflow
fallisce e conserva il backup. Consulta `journalctl --user -u mediapiayer.service`
oppure `sudo journalctl -u mediapiayer.service`, secondo il tipo di servizio.

Per sospendere gli aggiornamenti, imposta `AUTO_DEPLOY_ENABLED=false`. Il servizio
continua a usare la versione corrente. Per disinstallare la gestione delle release,
disattiva prima il workflow, ferma il servizio, riporta il checkout e le sue
dipendenze alla versione scelta, rimuovi solo l'override `auto-deploy.conf`,
esegui daemon-reload e riavvia. Conserva database, env e media.
