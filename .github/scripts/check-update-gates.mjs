// Read-only production gateway audit. Never send admin tokens or modify policies.
const request = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(14000), headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw Error('Non-JSON response ' + res.status); }
  return { status: res.status, json };
};
const origin = 'https://flixleo.cyou';
let errors = 0, unready = 0;
try {
  const health = await request(origin + '/api/gateway/v1/health');
  console.log('FlixLeo gateway health:', health.status, health.json);
  if (health.status !== 200 || health.json.ok !== true) errors++;
} catch (error) { console.error('Gateway health failed:', error.message); errors++; }
for (const [app, version] of [['flixleo-android',1],['flixleo-windows',1],['sabdham-android',17],['sri-tunnel-android',8]]) {
  try {
    const {status,json} = await request(origin + '/api/gateway/v1/check/' + app + '?versionCode=' + version);
    if (status !== 200 || !json.policy || json.policy.appId !== app ||
        !Array.isArray(json.notices)) throw Error('Unexpected response ' + status);
    if (json.ready !== true) {
      unready++;
      console.log('::warning::' + app + ': gateway not provisioned; safe non-blocking fallback');
      if (json.policy.updateAvailable || json.policy.forceUpdate || json.policy.maintenance) throw Error('Unsafe unprovisioned policy');
    } else {
      console.log(app + ': READY; latest=' + json.policy.latestVersionCode + ', forced=' + json.policy.forceUpdate);
    }
  } catch (error) { console.error('::error::' + app + ': ' + error.message); errors++; }
}
// Windows-only: require that the latest published installable EXE is offered
// by both the desktop download route and the Windows application update gate.
try {
  const status = await request(origin + '/api/download/windows/status');
  if (status.status !== 200 || status.json.ready !== true ||
      status.json.format !== 'installable-exe') {
    throw Error('Windows installer download is not ready');
  }
  const gate = await request(origin + '/api/gateway/v1/check/flixleo-windows?versionCode=3');
  const policy = gate.json.policy;
  if (gate.status !== 200 || gate.json.ready !== true ||
      !policy || policy.appId !== 'flixleo-windows' ||
      policy.latestVersionCode < 4 || policy.updateAvailable !== true ||
      !/^https:\/\//.test(policy.updateUrl || '') ||
      !/FlixLeo-Setup-\d+\.\d+\.\d+-x64\.exe$/.test(policy.updateUrl || '')) {
    throw Error('Windows update gate does not point to the current installable EXE');
  }
  const response = await fetch(origin + '/api/download/windows', {
    redirect: 'manual',
    signal: AbortSignal.timeout(14000)
  });
  if (response.status !== 302 ||
      !/FlixLeo-Setup-\d+\.\d+\.\d+-x64\.exe$/.test(response.headers.get('location') || '')) {
    throw Error('Windows button route did not redirect to the published installer');
  }
  console.log('FlixLeo Windows installer and update gate: READY; version=' + policy.latestVersionName +
    '; code=' + policy.latestVersionCode + '; download route verified');
} catch (error) {
  console.error('::error::FlixLeo Windows installer distribution: ' + error.message);
  errors++;
}
try {
  const { status } = await request(origin + '/api/gateway/v1/check/unknown?versionCode=1');
  if (status !== 400) throw Error('Invalid apps should return HTTP 400, received ' + status);
} catch (error) { console.error('::error::Bad app validation: '+error.message); errors++; }
try {
  const { status } = await request(origin + '/api/gateway/v1/admin/apps');
  if (status !== 401) throw Error('Admin authentication bypass? Unexpected status ' + status);
} catch (error) { console.error('::error::Admin authorization: '+error.message); errors++; }
try {
  const { status,json } = await request('https://sabdham-backend.onrender.com/api/app/update');
  if (status !== 200 || !Number.isInteger(json.latestVersionCode) ||
      !/^https:\/\//.test(json.downloadUrl || '')) throw Error('Release metadata missing/invalid ' + status);
  console.log('SABDHAM update feed: versionCode=' + json.latestVersionCode + ', forced=' + json.forceUpdate);
} catch (error) { console.error('::error::SABDHAM update feed: ' + error.message); errors++; }
console.log('Audit summary:', { errors, unready, checked:4 });
if (errors) process.exitCode = 1;
