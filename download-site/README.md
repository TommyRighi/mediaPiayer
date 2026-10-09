# Pagina di download MediaPiayer

Sito statico pubblicato su https://tommyrighi.github.io/mediaPiayer/ dal ramo `gh-pages`, directory radice. Nessun backend o configurazione personale è richiesto.

Gli installer desktop sono allegati alla prerelease `v1.0.0-desktop-preview` del repository. Contengono Tailscale e chiedono indirizzo e autorizzazione al primo avvio. Non distribuire file di configurazione, database, identità Tailscale o chiavi con gli installer.

La pagina distingue i download desktop dalla guida mobile: non esiste ancora un client MediaPiayer nativo per Android o iOS. Su mobile serve Tailscale ufficiale, un'identità autorizzata e il browser.

Per aggiornare, pubblicare prima i nuovi installer in una release GitHub, poi modificare i link e la versione in `index.html`. Aggiungere i checksum SHA-256 alla release. Il ramo `gh-pages` contiene solo i file di questo sito: mantenerlo separato dal codice e dalle modifiche in corso sul server.

Gli installer attuali sono di anteprima, non firmati; il collaudo end-to-end su dispositivi reali è ancora da completare. Per una distribuzione stabile, firmare e verificare gli installer su ciascuna piattaforma.
