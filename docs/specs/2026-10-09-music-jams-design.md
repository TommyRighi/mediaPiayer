# Musica e Jam

La libreria musicale esistente viene estesa con metadati incorporati, copertine,
ricerca e preparazione dei file incompatibili con il browser. Le Jam permettono
agli utenti autenticati di ascoltare una coda comune sui propri dispositivi.

## Libreria e riproduzione

La scansione legge cartelle annidate fino a otto livelli, ignorando collegamenti
simbolici, cartelle nascoste e file generati. `music-metadata` legge tag e durata;
Sharp normalizza le copertine. Una scansione successiva arricchisce le vecchie
righe senza sostituire titoli già presenti. Gli upload conservano il nome originale
come titolo di riserva quando mancano tag e titolo esplicito.

Il browser riproduce direttamente i formati che supporta. Gli errori di decodifica
o un formato dichiarato non supportato avviano la preparazione in MP3 a 192 kbps.
WMA viene preparato durante l'importazione. Il processo usa la coda condivisa
dei lavori multimediali e un thread; conserva il file originale e pubblica il
risultato solo dopo la conclusione del processo. I lavori interrotti ripartono
all'avvio. Gli errori di rete offrono un nuovo caricamento del flusso.

## Stanza condivisa

La funzione richiede l'impostazione sociale dell'amministratore. L'host crea una
stanza dalla coda in ascolto; la stanza parte in pausa. Gli invitati accedono con
il proprio account e un codice casuale. Ogni account può aggiungere brani. Solo
l'host può riordinare o rimuovere voci, terminare la stanza e scegliere se
condividere i comandi di riproduzione. Il volume rimane personale.

SQLite conserva stanze, membri e voci di coda. Ogni voce ha un identificativo
separato dal brano, permettendo ripetizioni. Il limite è 30 account e 200 voci.
L'uscita di un invitato rimuove la sua iscrizione; l'uscita dell'host chiude la
stanza. Un riavvio del server mette le stanze in pausa.

## Sincronizzazione e accesso

Le modifiche passano dalle API HTTP con controllo dell'origine, autenticazione,
verifica dell'iscrizione e revisione della stanza. Una revisione superata riceve
409 e il client recupera lo stato. Il WebSocket trasporta stato e ping temporali;
non accetta comandi. I token limitati allo streaming non autorizzano le stanze.
La revoca della sessione chiude anche i socket delle Jam.

Il server conserva posizione, stato di riproduzione e istante di aggiornamento.
I client stimano il ritardo dai ping e correggono differenze superiori a 650 ms
con un seek; differenze minori possono usare velocità 0,98 o 1,02. Il server
avanza i brani con durata nota anche quando l'host non è collegato. Gli eventi
di fine brano dell'host verificano revisione e voce corrente per evitare salti
doppi. La preparazione del brano corrente mette in pausa tutte le stanze che
lo stanno ascoltando. La ripresa richiede un comando esplicito dopo la conversione.

La perdita del socket mette in pausa il dispositivo. La riconnessione riprova
con attese da uno a dieci secondi e recupera posizione e coda. L'ID della stanza
è salvato sul dispositivo per account. I browser che bloccano autoplay mostrano
il pulsante Enable sound. Media Session espone metadati e comandi sui browser
compatibili; la riproduzione in background resta soggetta ai limiti del sistema.

## Verifica

I test usano database temporanei, audio WAV reale con tag e copertina, prove
di importazione, ricerca e streaming con Range, conversione, inviti, permessi,
revisioni concorrenti, avanzamento, chiusura e revoca dei socket. Una prova con
due account nel browser verifica ingresso durante la riproduzione, pausa
condivisa, aggiunta alla coda, ripristino dopo refresh e riconnessione.
