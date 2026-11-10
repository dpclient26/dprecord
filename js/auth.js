// Auth Guard & Early Theme Initialization — Runs synchronously in <head> before page renders
(function(){const s=localStorage.getItem('dp_theme')||'light';document.documentElement.setAttribute('data-bs-theme',s);document.documentElement.setAttribute('data-theme',s)})();
const token=sessionStorage.getItem('ops_portal_token');
if(!token){document.documentElement.style.visibility='hidden';document.documentElement.style.overflow='hidden';window.location.replace('/login');throw new Error('AUTH_REDIRECT')}
function logout(){stopInactivityTimer();sessionStorage.removeItem('ops_portal_token');sessionStorage.removeItem('ops_portal_user');sessionStorage.removeItem('ops_portal_records_cache');window.location.replace('/login')}
const INACTIVITY_TIMEOUT_MS=180000;let _inactivityTimer=null,_lastActivityThrottle=0;
function resetInactivityTimer(){if(_inactivityTimer)clearTimeout(_inactivityTimer);_inactivityTimer=setTimeout(()=>{if(sessionStorage.getItem('ops_portal_token'))logout()},INACTIVITY_TIMEOUT_MS)}
function stopInactivityTimer(){if(_inactivityTimer){clearTimeout(_inactivityTimer);_inactivityTimer=null}}
function onUserActivity(){const n=Date.now();if(n-_lastActivityThrottle<1000)return;_lastActivityThrottle=n;resetInactivityTimer()}
if(token){['mousemove','mousedown','keydown','scroll','touchstart','click'].forEach(e=>{document.addEventListener(e,onUserActivity,{passive:true})});resetInactivityTimer()}
