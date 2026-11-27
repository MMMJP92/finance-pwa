// Headless tests for the v1 sync fixes. Usage: npm i jsdom@24 && node tests/sync.test.js index.html
const fs = require("fs");
const { JSDOM } = require("jsdom");
const html = fs.readFileSync(process.argv[2], "utf8")
  .replace(/<script src="https:\/\/alcdn[^>]*><\/script>/, ""); // no network: MSAL absent

let failures = 0, passes = 0;
function ok(cond, name){ if(cond){ passes++; console.log("  ✓ " + name); } else { failures++; console.log("  ✗ " + name); } }

function boot(stored){
  const dom = new JSDOM(html, {
    url: "https://mmmjp92.github.io/finance-pwa/",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w){
      if(stored) w.localStorage.setItem("finance-pwa-state-v1", JSON.stringify(stored));
      w.confirm = () => true;
      w.scrollTo = () => {};
      w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
    }
  });
  return dom.window;
}
const ACCTS = [
  {id:"td-cheq", name:"TD Chequing", kind:"银行 · 支票", ccy:"CAD", bal:0},
  {id:"rogers", name:"Rogers Master", kind:"信用卡", ccy:"CAD", bal:0},
  {id:"cash-usd", name:"Cash USD", kind:"现金", ccy:"USD", bal:0},
  {id:"tfsa", name:"TD TFSA", kind:"投资 · 注册账户", ccy:"CAD", bal:0}
];
function legacyState(){
  return {
    accounts: JSON.parse(JSON.stringify(ACCTS)), baseBals:{"td-cheq":1000, "rogers":0, "cash-usd":100, "tfsa":0},
    txns: [
      {id:1, type:"expense", date:"2026-11-20", amt:2.5, cat:"早午晚餐", nature:"flex", acct:"rogers", merchant:"", note:"", updatedAt:1000},
      {id:2, type:"expense", date:"2026-11-20", amt:2.5, cat:"早午晚餐", nature:"flex", acct:"rogers", merchant:"", note:"", updatedAt:1001},
      {id:3, type:"refund",  date:"2026-11-21", amt:2.5, cat:"早午晚餐", nature:"flex", acct:"rogers", merchant:"", note:"退", linkedTo:"1", updatedAt:1002},
      {id:4, type:"income",  date:"2026-11-01", amt:3000, cat:"工资收入", nature:"fixed", acct:"td-cheq", merchant:"", note:"工资", updatedAt:1003}
    ],
    budgets:[], merchants:[{name:"Costco", cat:"超市买菜"}], templates:[{name:"X", type:"expense", cat:"房租"}], holdings:[],
    seq:5, lastSyncAt:0, deletedKeys:[], zhMigrated:true
  };
}
const clone = o => JSON.parse(JSON.stringify(o));

console.log("1. Legacy records get uids and refund links are rewritten");
let w = boot(legacyState());
ok(w.txns.every(t => t.uid), "every record has a uid");
ok(new Set(w.txns.map(t => t.uid)).size === 4, "uids are unique (same-day twins differ)");
ok(w.txns[2].linkedToUid === w.txns[0].uid, "refund linkedTo:1 -> uid of record 1");
const uidsA = w.txns.map(t => t.uid);
let w2 = boot(legacyState());
ok(JSON.stringify(w2.txns.map(t => t.uid)) === JSON.stringify(uidsA), "a second device derives identical legacy uids");

console.log("2. Merge with a pre-upgrade cloud file does not duplicate");
let remote = clone(legacyState()); // no uids, like the file on OneDrive today
let r = w.mergeRemote(remote);
ok(w.txns.length === 4, "still 4 records after merge (got " + w.txns.length + ")");
ok(r.added === 0, "nothing counted as new");

console.log("3. Same-day twins survive sync (old bug: one was dropped)");
const twins = w.txns.filter(t => t.date === "2026-11-20" && t.amt === 2.5 && t.type === "expense");
ok(twins.length === 2, "both CAD $2.50 records still present");

console.log("4. Editing a record does not resurrect the old version");
w = boot(legacyState());
const cloudBefore = clone(w.buildDataFile()); // cloud holds the pre-edit version (with uids)
const target = w.txns.find(t => t.id === 4);
w.startEdit(target.uid);
w.document.getElementById("fAmt").value = "3100";
w.document.getElementById("btnAdd").click();
ok(w.txnByUid(target.uid).amt === 3100, "edit applied locally");
w.mergeRemote(cloudBefore);
ok(w.txns.length === 4, "no duplicate after merging the stale cloud copy (got " + w.txns.length + ")");
ok(w.txnByUid(target.uid).amt === 3100, "newer local edit wins");
// and the other direction: another device has the newer edit
let w3 = boot(legacyState());
w3.mergeRemote(clone(w.buildDataFile()));
ok(w3.txnByUid(target.uid).amt === 3100 && w3.txns.length === 4, "other device picks up the edit in place");

console.log("5. Delete removes exactly one twin and propagates");
w = boot(legacyState());
const tw = w.txns.filter(t => t.id === 1 || t.id === 2);
w.deleteTxn(tw[0].uid);
ok(w.txns.length === 3 && w.txnByUid(tw[1].uid), "one twin deleted, the other kept");
ok(w.deletedKeys.some(d => d.uid === tw[0].uid) && !w.deletedKeys.some(d => d.key), "tombstone is by uid");
w3 = boot(legacyState());
w3.mergeRemote(clone(w.buildDataFile()));
ok(w3.txns.length === 3 && !w3.txnByUid(tw[0].uid) && w3.txnByUid(tw[1].uid), "deletion syncs to the other device, twin survives");
w.mergeRemote(clone(boot(legacyState()).buildDataFile()));
ok(w.txns.length === 3, "stale copy from another device does not resurrect the deleted record");

console.log("6. Legacy key tombstones are still honoured");
let st = legacyState(); st.deletedKeys = [{key:"2026-11-01|3000|工资", deletedAt:5000}];
w = boot(legacyState());
w.mergeRemote(st);
ok(!w.txns.some(t => t.amt === 3000), "record deleted by an older build stays deleted");

console.log("7. Colliding numeric ids across devices");
w = boot(legacyState());
const a = {id:9, uid:"aaa", type:"expense", date:"2026-11-22", amt:10, cat:"加油", nature:"flex", acct:"rogers", note:"A", updatedAt:2000};
const b = {id:9, uid:"bbb", type:"expense", date:"2026-11-22", amt:20, cat:"加油", nature:"flex", acct:"rogers", note:"B", updatedAt:2001};
w.txns.push(a); w.applyBalance(a, 1);
let rr = clone(w.buildDataFile()); rr.txns = rr.txns.filter(t => t.uid !== "aaa"); rr.txns.push(b);
w.mergeRemote(rr);
ok(w.txns.filter(t => t.id === 9).length === 2, "both id-9 records present after merge");
w.deleteTxn("aaa");
ok(!w.txnByUid("aaa") && w.txnByUid("bbb"), "delete removes only the clicked one");

console.log("8. Balances, currency and net worth");
w = boot(legacyState());
w.recomputeBalances(); // fixture stores bal:0; v1 trusts stored balances on load
const bal = id => w.acctById(id).bal;
ok(bal("rogers") === -2.5, "Rogers = -5.00 + 2.50 refund = -2.50 (got " + bal("rogers") + ")");
ok(bal("td-cheq") === 4000, "TD Chequing = 1000 + 3000 (got " + bal("td-cheq") + ")");
for(let i = 0; i < 10; i++){ const t = {id:100+i, uid:"f"+i, type:"expense", date:"2026-11-23", amt:0.1, cat:"其他支出", nature:"once", acct:"td-cheq", note:"f"+i, updatedAt:3000+i}; w.txns.push(t); w.applyBalance(t, 1); }
w.recomputeBalances();
ok(bal("td-cheq") === 3999, "10 × 0.10 subtracts to exactly 3999.00 (got " + bal("td-cheq") + ")");
w.renderAll();
const nwText = () => w.document.getElementById("nwValue").textContent;
ok(/1:1/.test(w.document.getElementById("fxMsg").textContent), "warns when USD rate missing");
w.fxRates.USD = {rate:1.4, updatedAt:1}; w.nwShown = null; w.renderAll();
ok(w.document.getElementById("fxMsg").textContent === "", "warning cleared once rate set");
// avail = 3999 - 2.5 + 100*1.4 = 4136.50 ; invest (no holdings) = tfsa 0
ok(nwText().includes("4,136.50"), "net worth converts USD at 1.4: " + nwText());
ok(w.document.getElementById("acctList").innerHTML.includes("USD $100.00"), "USD account shown in USD");
w.holdings = [{name:"GIC", type:"GIC", value:5000}]; w.acctById("tfsa").bal = 4000; w.nwShown = null; w.renderAll();
ok(nwText().includes("9,136.50"), "holdings counted once, TFSA balance not double-counted: " + nwText());

console.log("9. Sync loop: If-Match, 412 retry, fallback");
(async () => {
  w = boot(legacyState());
  w.odAccount = {username:"me"}; Object.defineProperty(w.navigator, "onLine", {value:true, configurable:true});
  let cloud = clone(w.buildDataFile()), etag = '"v1"', puts = [], forced412 = 0;
  w.ensureFinanceFolder = () => Promise.resolve();
  w.graphFetch = (path, o) => {
    const res = (status, body) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body||"")) });
    if(o.method === "GET" && path === w.OD_ITEM_PATH) return res(200, {eTag: etag});
    if(o.method === "GET") return res(200, clone(cloud));
    if(o.method === "PUT"){
      puts.push(o.headers["If-Match"] || null);
      if(forced412 > 0 && o.headers["If-Match"]){ forced412--; etag = '"v' + (puts.length+1) + '"'; return res(412, {}); }
      if(o.headers["If-Match"] && o.headers["If-Match"] !== etag) return res(412, {});
      cloud = JSON.parse(o.body); etag = '"v' + (puts.length+1) + '"'; return res(200, {});
    }
  };
  const waitSync = () => new Promise(res => { const i = setInterval(() => { if(!w.syncing){ clearInterval(i); res(); } }, 5); });
  w.syncNow(false); await waitSync();
  ok(puts[0] === '"v1"', "push carries If-Match with the pulled eTag");
  ok(/同步完成/.test(w.document.getElementById("syncMsg").textContent), "normal sync completes");
  puts = []; forced412 = 1; w.settingsDirty = true;
  w.syncNow(false); await waitSync();
  ok(puts.length === 2 && /同步完成/.test(w.document.getElementById("syncMsg").textContent), "one 412 -> re-pull and succeed");
  puts = []; forced412 = 5; w.settingsDirty = true;
  w.syncNow(false); await waitSync();
  ok(puts.length === 3 && puts[2] === null && /同步完成/.test(w.document.getElementById("syncMsg").textContent), "persistent 412 -> third round pushes unconditionally");
  ok(cloud.txns.length === 4 && cloud.txns.every(t => t.uid) && cloud.version === 3, "cloud file now holds uids (version 3)");

  console.log("10. JSON import uses the same merge");
  w = boot(legacyState());
  const file = clone(w.buildDataFile());
  file.txns.push({id:1, uid:"new-1", type:"expense", date:"2026-11-24", amt:7, cat:"加油", nature:"flex", acct:"rogers", note:"", updatedAt:9000});
  file.accounts.push({id:"new-acct", name:"New", kind:"现金", ccy:"CAD", bal:0});
  w.pendingImport = {json:file}; w.doImport();
  ok(w.txns.length === 5 && w.acctById("new-acct"), "import adds the new record and the missing account, no duplicates");

  console.log("\n" + passes + " passed, " + failures + " failed");
  process.exit(failures ? 1 : 0);
})();
