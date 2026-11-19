export const IDLE_MS = 180000, WARNING_MS = 150000;

// No API request, refresh, focus, visibility event or synthetic event is activity.
// Storage contains timestamps/status only, never passwords or session tokens.
export function idleClock({now, read, write, schedule, cancel, warning, expire}) {
  let timer, stopped = false, locked = false;
  const check = () => {
    if (stopped || locked) return false;
    cancel(timer);
    const state = read(), time = now();
    if (!state || !Number.isFinite(state.at) || state.at > time || state.ended || time - state.at >= IDLE_MS) {
      locked = true;
      write({at: state?.at || time, ended: true});
      warning(false);
      expire();
      return false;
    }
    const elapsed = time - state.at;
    warning(elapsed >= WARNING_MS);
    timer = schedule(check, (elapsed < WARNING_MS ? WARNING_MS : IDLE_MS) - elapsed);
    return true;
  };
  return {
    check,
    activity(event) {
      // Check overdue deadline BEFORE allowing a returning user's event to reset it.
      if (!event.isTrusted || !check()) return;
      write({at:now(), ended:false});
      check();
    },
    stop() {stopped = true; cancel(timer);},
    get locked() {return locked;}
  };
}

const keyFor = id => 'chefduo-idle-v1:' + id;
export function beginIdleSession(id) {
  localStorage.setItem(keyFor(id), JSON.stringify({at:Date.now(), ended:false}));
}

export function attachIdleSession({client, user, app, loginURL, window:win=window, document:doc=document}) {
  const key = keyFor(user.id);
  let dirty = false, expiring = false, operation;
  const read = () => {try {return JSON.parse(win.localStorage.getItem(key));} catch {return null;}};
  const write = value => {try {win.localStorage.setItem(key, JSON.stringify(value));} catch {/* Failure closes access at next check. */}};
  // First rollout/first invitation activation only; subsequent page loads retain deadline.
  if (!read()) write({at:Date.now(), ended:false});
  const notice = doc.createElement('section');
  notice.className = 'idle-warning notice';
  notice.setAttribute('role','alert');
  notice.hidden = true;
  const message = doc.createElement('p');
  const stay = doc.createElement('button');
  stay.type = 'button'; stay.textContent = 'Continue working';
  notice.append(message,stay); doc.body.append(notice);
  const setWarning = show => {
    notice.hidden = !show;
    message.textContent = 'You have been inactive for at least 2 minutes 30 seconds. Your session ends at 3 minutes of inactivity.' +
      (dirty ? ' You have unsaved changes. Save them before the deadline; they will not be saved automatically.' : '');
  };
  const lockedScreen = () => {
    app.replaceChildren();
    const panel = doc.createElement('section'); panel.className='panel idle-locked';
    const text = doc.createElement('p'); text.setAttribute('role','alert');
    text.textContent='Your inactive session is locked. Completing global sign-out…';
    const retry = doc.createElement('button'); retry.type='button'; retry.textContent='Retry secure sign-out'; retry.hidden=true;
    retry.addEventListener('click', () => {void revoke();});
    panel.append(text,retry); app.append(panel);
    return {text,retry};
  };
  let screen;
  const revoke = () => {
    if (operation) return operation;
    operation = (async () => {
      let timeout;
      try {
        const result = await Promise.race([
          client.auth.signOut({scope:'global'}),
          new Promise((_,reject)=>{timeout=win.setTimeout(()=>reject(Error('Sign-out not confirmed')),8000);})
        ]);
        if (result?.error) throw result.error;
        win.sessionStorage.removeItem('chefduo-draft-saved');
        win.location.replace(loginURL);
      } catch {
        // Never call this a successful server revocation. Keep UI blocked and retry
        // only on explicit action or connectivity restoration, without polling.
        screen.text.textContent='Session locked. Server-side sign-out could not be confirmed. Reconnect and retry secure sign-out. Do not leave this page until it completes.';
        screen.retry.hidden=false;
      } finally {win.clearTimeout(timeout); operation=null;}
    })();
    return operation;
  };
  const lock = () => {
    if (expiring) return;
    expiring=true;
    Promise.resolve(client.auth.stopAutoRefresh()).catch(()=>{});
    screen=lockedScreen();
    void revoke();
  };
  const clock=idleClock({now:()=>Date.now(),read,write,schedule:(fn,ms)=>win.setTimeout(fn,ms),cancel:id=>win.clearTimeout(id),warning:setWarning,expire:lock});
  const activity = event => {
    if (doc.visibilityState === 'hidden' || (event.type === 'pointermove' && !event.buttons)) return;
    clock.activity(event);
  };
  const check = () => clock.check();
  const storage = event => {if(event.key === key || event.key === null) check();};
  const online = () => {if(expiring) void revoke(); else check();};
  const dirtyInput = event => {if(event.isTrusted && event.target?.closest('form')) {dirty=true;if(!notice.hidden)setWarning(true);}};
  const beforeUnload = event => {if(dirty && !expiring){event.preventDefault();event.returnValue='';}};
  const block = event => {if(expiring && event.target?.closest('.idle-locked'))return; if(expiring || !clock.check()){event.preventDefault();event.stopImmediatePropagation();}};
  // Capture guard also blocks stale forms before their own handlers run on wake.
  for(const name of ['pointerdown','click','keydown','input','change','wheel','touchstart','touchmove','pointermove']) doc.addEventListener(name,activity,{capture:true,passive:true});
  for(const name of ['submit','click']) doc.addEventListener(name,block,true);
  doc.addEventListener('input',dirtyInput,true); doc.addEventListener('change',dirtyInput,true);
  doc.addEventListener('visibilitychange',check);
  win.addEventListener('storage',storage);win.addEventListener('focus',check);win.addEventListener('pageshow',check);win.addEventListener('online',online);
  win.addEventListener('beforeunload',beforeUnload);
  stay.addEventListener('click',activity);
  clock.check();
  return {
    check,
    get locked(){return expiring;},
    saved(){dirty=false;},
    finishLocalRender(){if(expiring && !app.querySelector('.idle-locked'))screen=lockedScreen();},
    signedOut(){write({at:Date.now(),ended:true});},
    logout(){write({at:read()?.at || Date.now(),ended:true});clock.check();},
    dispose(){clock.stop();notice.remove();}
  };
}
