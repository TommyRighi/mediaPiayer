const $ = id => document.getElementById(id);
let connected = false;
function render(message) {
  const busy = message.type === 'login' || message.value === 'connecting';
  connected = message.value === 'connected';
  $('connect').disabled = busy || connected;
  $('connect').textContent = connected ? 'Collegato' : busy ? 'Collegamento in corso…' : 'Collega la biblioteca →';
  $('status').textContent = message.type === 'error' || message.type === 'login' ? message.value : ({ connecting:'Attendi il collegamento. Il dispositivo potrebbe richiedere l’approvazione dell’amministratore.',connected:'Biblioteca collegata.',idle:'' }[message.value] || '');
  $('status').className = message.type === 'error' ? 'error' : '';
  $('login').hidden = message.type !== 'login';
  if (busy || connected) $('reset').hidden = false;
}
window.connection.onStatus(render);
$('connect-form').addEventListener('submit',async e => {
  e.preventDefault();
  const authKey = $('auth-key').value.trim(); $('auth-key').value = '';
  render({type:'status',value:'connecting'});
  try { await window.connection.connect({target:$('target').value.trim(),authKey}); } catch(err) { render({type:'error',value:err.message}); }
});
$('login').addEventListener('click',() => window.connection.openLogin().catch(err => render({type:'error',value:err.message})));
$('reset').addEventListener('click',async () => {
  if (!window.confirm('Scollegare questa installazione? Per ricollegarla servirà una nuova chiave o l’accesso Tailscale. Il dispositivo va anche revocato dalla console Tailscale.')) return;
  await window.connection.reset(); $('auth-key').value = ''; $('reset').hidden = true;
});
window.connection.settings().then(async settings => {
  $('target').value = settings.target; $('reset').hidden = !settings.hasIdentity;
  render(settings.status);
  if (settings.hasIdentity && settings.status.value === 'idle') {
    try { await window.connection.connect({target:settings.target,authKey:''}); } catch(err) { render({type:'error',value:err.message}); }
  }
}).catch(err => render({type:'error',value:err.message}));
