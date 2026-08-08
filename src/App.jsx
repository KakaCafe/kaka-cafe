import { useState, useRef, useCallback, useEffect } from "react";

const FB = "https://kaka-cafe-pos-default-rtdb.asia-southeast1.firebasedatabase.app";
const FB_BASE = `${FB}/cafes/kaka-main`;

// Write (PUT) — returns promise
const fbSet = (path, data) =>
  fetch(`${FB_BASE}/${path}.json`, {
    method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)
  }).catch(e=>console.warn("[fbSet]",e.message));

// Push (POST) — returns promise resolving to new Firebase key
const fbPush = (path, data) =>
  fetch(`${FB_BASE}/${path}.json`, {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)
  }).then(r=>r.json()).then(j=>j.name).catch(e=>{ console.warn("[fbPush]",e.message); return null; });

// Delete
const fbDel = (path) =>
  fetch(`${FB_BASE}/${path}.json`, {method:"DELETE"}).catch(()=>{});

// Read once — always fresh, no cache
const fbGet = (path) =>
  fetch(`${FB_BASE}/${path}.json`, {cache:"no-store"})
    .then(r=>r.json()).catch(()=>null);

// Subscribe via polling — reliable on Cloudflare Pages and all hosts
// SSE (EventSource) is blocked by Cloudflare on external domains, so we poll instead
// intervals: bills/customers/settings = 4s, tables handled separately
const fbSubscribe = (path, cb, intervalMs=4000) => {
  let timer;
  const poll = () =>
    fetch(`${FB_BASE}/${path}.json`, {cache:"no-store"})
      .then(r=>r.json()).then(d=>cb(d??null)).catch(()=>{});
  poll(); // immediate first fetch
  timer = setInterval(poll, intervalMs);
  return () => clearInterval(timer);
};


// ── QR Token — encode table info so URL is opaque ────────────────────────────
// Encodes: {t: tableId, v: 1} → base64 → used as ?o=<token>
// Customers see a short unreadable token, not table/cafe params
// ── QR Token — opaque encoding, hides table number and Netlify URL ───────────
// Uses XOR + base62 so the token looks random and reveals nothing.
// Even if someone reads the QR, they only see gibberish like ?o=k3Xm9pQr
// QR token: encrypt tableId so URL is fully opaque (no table number visible)
// Uses multi-round byte-level XOR mixing — token like "mX7kQp2" reveals nothing
const _QK = [0x4B,0x43,0x32,0x30,0x32,0x36,0x5A,0x71,0x38,0x4E,0x76,0x52]; // "KC2026Zq8NvR"
const _b62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const _toB62 = n => { let s=""; do{s=_b62[n%62]+s;n=Math.floor(n/62);}while(n>0); return s; };
const _fromB62 = s => [...s].reduce((a,c)=>a*62+_b62.indexOf(c),0);

const encodeQRToken = (tableId) => {
  try {
    // Pack tableId + random 16-bit salt into 3 bytes: [salt_hi, salt_lo ^ tableId, tableId ^ salt_hi]
    const salt = Math.floor(Math.random()*0xFFFF);
    const b0 = (salt >> 8) & 0xFF;
    const b1 = (salt & 0xFF) ^ (tableId & 0xFF);
    const b2 = tableId ^ b0;
    // XOR each byte with rotating key
    const e0 = b0 ^ _QK[0] ^ _QK[9];
    const e1 = b1 ^ _QK[3] ^ _QK[7];
    const e2 = b2 ^ _QK[6] ^ _QK[11];
    // Pack into single number with large offset so output is always 5+ chars
    const packed = (e0 * 65536) + (e1 * 256) + e2 + 0x100000;
    return _toB62(packed);
  } catch(e) { return _toB62(tableId + 0x100000); }
};
const decodeQRToken = (token) => {
  try {
    const packed = _fromB62(token) - 0x100000;
    if(packed < 0 || packed > 0xFFFFFF) return null;
    const e0 = (packed >> 16) & 0xFF;
    const e1 = (packed >> 8) & 0xFF;
    const e2 = packed & 0xFF;
    const b0 = e0 ^ _QK[0] ^ _QK[9];
    const b1 = e1 ^ _QK[3] ^ _QK[7];
    const b2 = e2 ^ _QK[6] ^ _QK[11];
    const tableId = b2 ^ b0;
    // Verify consistency: b1 should equal (salt_lo ^ tableId), b0 = salt_hi
    const salt_lo_check = b1 ^ (tableId & 0xFF);
    // salt_lo can be anything 0-255, just verify tableId is valid
    return (tableId >= 1 && tableId <= 20) ? tableId : null;
  } catch(e) { return null; }
};

const DEFAULT_INFO = {
  name: "Kaka Cafe", tagline: "Fresh Food · Authentic Flavors · No Palm Oil",
  address: "Bengaluru, Karnataka", phone: "7022470962",
  email: "@kakacafe.blr", gstin: "", hours: "9:30 AM – 11:30 PM",
  upiId: "", googleReview: "", adminPass: "1234", staffPin: "0000",
  publicUrl: "", kitchenPhone: "",
  cafeId: "kaka-main",
};

const INITIAL_INGREDIENTS = [
  { id:"ing1",  name:"Milk",           unit:"ml",     stock:10000, low:1000 },
  { id:"ing2",  name:"Sugar",          unit:"g",      stock:5000,  low:500  },
  { id:"ing3",  name:"Tea Powder",     unit:"g",      stock:2000,  low:200  },
  { id:"ing4",  name:"Coffee Powder",  unit:"g",      stock:1000,  low:100  },
  { id:"ing5",  name:"Lemon",          unit:"pcs",    stock:50,    low:10   },
  { id:"ing6",  name:"Potatoes",       unit:"g",      stock:20000, low:3000 },
  { id:"ing7",  name:"Paneer",         unit:"g",      stock:5000,  low:500  },
  { id:"ing8",  name:"Onion",          unit:"g",      stock:10000, low:2000 },
  { id:"ing9",  name:"Tomato",         unit:"g",      stock:8000,  low:2000 },
  { id:"ing10", name:"Oil",            unit:"ml",     stock:5000,  low:500  },
  { id:"ing11", name:"Ghee",           unit:"ml",     stock:2000,  low:200  },
  { id:"ing12", name:"Wheat Flour",    unit:"g",      stock:15000, low:2000 },
  { id:"ing13", name:"Rice",           unit:"g",      stock:20000, low:3000 },
  { id:"ing14", name:"Dal",            unit:"g",      stock:10000, low:2000 },
  { id:"ing15", name:"Cauliflower",    unit:"g",      stock:5000,  low:500  },
  { id:"ing16", name:"Cheese",         unit:"g",      stock:2000,  low:200  },
  { id:"ing17", name:"Bread",          unit:"pcs",    stock:40,    low:10   },
  { id:"ing18", name:"Butter",         unit:"g",      stock:1000,  low:100  },
  { id:"ing19", name:"Curd",           unit:"g",      stock:3000,  low:300  },
  { id:"ing20", name:"Corn",           unit:"g",      stock:3000,  low:300  },
  { id:"ing21", name:"Maggi Noodles",  unit:"pcs",    stock:30,    low:5    },
  { id:"ing22", name:"Cashew",         unit:"g",      stock:500,   low:50   },
  { id:"ing23", name:"Mushroom",       unit:"g",      stock:1000,  low:100  },
  { id:"ing24", name:"Green Peas",     unit:"g",      stock:2000,  low:200  },
  { id:"ing25", name:"Dry Fruits",     unit:"g",      stock:500,   low:50   },
  { id:"ing26", name:"Mint Leaves",    unit:"g",      stock:200,   low:30   },
  { id:"ing27", name:"Soda",           unit:"ml",     stock:3000,  low:500  },
  { id:"ing28", name:"Ice Cream",      unit:"scoops", stock:40,    low:5    },
  { id:"ing29", name:"Jaggery",        unit:"g",      stock:1000,  low:100  },
  { id:"ing30", name:"Spice Mix",      unit:"g",      stock:1000,  low:100  },
];


const INITIAL_MENU = [
  {id:1, name:"French Fries",           cat:"Quick Bites",        price:90,  recipe:[{i:"ing6",q:150},{i:"ing10",q:50},{i:"ing30",q:5}]},
  {id:2, name:"Peri Peri French Fries", cat:"Quick Bites",        price:110, recipe:[{i:"ing6",q:150},{i:"ing10",q:50},{i:"ing30",q:8}]},
  {id:3, name:"Chilli Garlic Bites",    cat:"Quick Bites",        price:130, recipe:[{i:"ing6",q:120},{i:"ing10",q:40},{i:"ing30",q:5}]},
  {id:4, name:"Cheese Grilled Sandwich",cat:"Quick Bites",        price:140, recipe:[{i:"ing17",q:2},{i:"ing16",q:40},{i:"ing18",q:15}]},
  {id:5, name:"Maggie",                 cat:"Quick Bites",        price:40,  recipe:[{i:"ing21",q:1},{i:"ing30",q:3}]},
  {id:6, name:"Veg Maggie",             cat:"Quick Bites",        price:60,  recipe:[{i:"ing21",q:1},{i:"ing8",q:30},{i:"ing9",q:30}]},
  {id:7, name:"Bread Butter",           cat:"Quick Bites",        price:35,  recipe:[{i:"ing17",q:2},{i:"ing18",q:20}]},
  {id:8, name:"Green Salad",            cat:"Quick Bites",        price:45,  recipe:[{i:"ing8",q:30},{i:"ing9",q:30},{i:"ing5",q:0.5}]},
  {id:9, name:"Bhel Puri",              cat:"Desi Starters",      price:45,  recipe:[{i:"ing30",q:10},{i:"ing8",q:20},{i:"ing9",q:20}]},
  {id:10,name:"Dal Pakwaan",            cat:"Desi Starters",      price:140, recipe:[{i:"ing14",q:80},{i:"ing12",q:60},{i:"ing30",q:5}]},
  {id:11,name:"Dahi Pakwaan",           cat:"Desi Starters",      price:120, recipe:[{i:"ing19",q:100},{i:"ing12",q:60},{i:"ing30",q:5}]},
  {id:12,name:"Desi Crispy Corn",       cat:"Desi Starters",      price:90,  recipe:[{i:"ing20",q:150},{i:"ing10",q:30},{i:"ing30",q:5}]},
  {id:13,name:"Masala Corn",            cat:"Desi Starters",      price:70,  recipe:[{i:"ing20",q:150},{i:"ing30",q:8}]},
  {id:14,name:"Crispy Corn",            cat:"Desi Starters",      price:120, recipe:[{i:"ing20",q:150},{i:"ing10",q:30},{i:"ing16",q:20}]},
  {id:15,name:"Masala Papad",           cat:"Desi Starters",      price:50,  recipe:[{i:"ing30",q:5}]},
  {id:16,name:"Cheese Masala Papad",    cat:"Desi Starters",      price:75,  recipe:[{i:"ing16",q:30},{i:"ing30",q:5}]},
  {id:17,name:"Chilly Paneer",          cat:"Chinese Starters",   price:200, recipe:[{i:"ing7",q:200},{i:"ing8",q:50},{i:"ing30",q:10}]},
  {id:18,name:"Paneer Manchurian",      cat:"Chinese Starters",   price:210, recipe:[{i:"ing7",q:200},{i:"ing9",q:50},{i:"ing30",q:10}]},
  {id:19,name:"Paneer 65",              cat:"Chinese Starters",   price:210, recipe:[{i:"ing7",q:200},{i:"ing10",q:40},{i:"ing30",q:10}]},
  {id:20,name:"Gobi Manchurian",        cat:"Chinese Starters",   price:190, recipe:[{i:"ing15",q:200},{i:"ing9",q:50},{i:"ing30",q:10}]},
  {id:21,name:"Chilly Gobi",            cat:"Chinese Starters",   price:180, recipe:[{i:"ing15",q:200},{i:"ing8",q:50},{i:"ing30",q:10}]},
  {id:22,name:"Aloo Paratha",           cat:"Parathas",           price:100, recipe:[{i:"ing12",q:80},{i:"ing6",q:100},{i:"ing11",q:15}]},
  {id:23,name:"Onion Paratha",          cat:"Parathas",           price:100, recipe:[{i:"ing12",q:80},{i:"ing8",q:60},{i:"ing11",q:15}]},
  {id:24,name:"Gobi Paratha",           cat:"Parathas",           price:110, recipe:[{i:"ing12",q:80},{i:"ing15",q:100},{i:"ing11",q:15}]},
  {id:25,name:"Paneer Paratha",         cat:"Parathas",           price:130, recipe:[{i:"ing12",q:80},{i:"ing7",q:80},{i:"ing11",q:15}]},
  {id:26,name:"Garlic Paratha",         cat:"Parathas",           price:130, recipe:[{i:"ing12",q:80},{i:"ing11",q:20}]},
  {id:27,name:"Cheese Paratha",         cat:"Parathas",           price:140, recipe:[{i:"ing12",q:80},{i:"ing16",q:40},{i:"ing11",q:15}]},
  {id:28,name:"Kaka's Special Paratha", cat:"Parathas",           price:140, recipe:[{i:"ing12",q:80},{i:"ing7",q:50},{i:"ing8",q:30},{i:"ing11",q:15}]},
  {id:29,name:"Kaka's Cheese Special",  cat:"Parathas",           price:160, recipe:[{i:"ing12",q:80},{i:"ing16",q:50},{i:"ing7",q:50},{i:"ing11",q:20}]},
  {id:30,name:"Paneer Butter Masala",   cat:"Curries",            price:210, recipe:[{i:"ing7",q:200},{i:"ing9",q:100},{i:"ing18",q:30},{i:"ing30",q:10}]},
  {id:31,name:"Kadai Paneer",           cat:"Curries",            price:230, recipe:[{i:"ing7",q:200},{i:"ing8",q:60},{i:"ing9",q:80},{i:"ing30",q:10}]},
  {id:32,name:"Paneer Bhurji",          cat:"Curries",            price:240, recipe:[{i:"ing7",q:200},{i:"ing8",q:50},{i:"ing9",q:60}]},
  {id:33,name:"Matar Paneer",           cat:"Curries",            price:230, recipe:[{i:"ing7",q:150},{i:"ing24",q:100},{i:"ing9",q:80}]},
  {id:34,name:"Kaju Paneer",            cat:"Curries",            price:250, recipe:[{i:"ing7",q:150},{i:"ing22",q:30},{i:"ing9",q:80}]},
  {id:35,name:"Kaju Curry",             cat:"Curries",            price:240, recipe:[{i:"ing22",q:50},{i:"ing9",q:100},{i:"ing18",q:20}]},
  {id:36,name:"Mushroom Masala",        cat:"Curries",            price:240, recipe:[{i:"ing23",q:200},{i:"ing9",q:80},{i:"ing8",q:50}]},
  {id:37,name:"Jeera Aloo (Dry)",       cat:"Curries",            price:120, recipe:[{i:"ing6",q:200},{i:"ing11",q:15}]},
  {id:38,name:"Aloo Tamatar",           cat:"Curries",            price:120, recipe:[{i:"ing6",q:150},{i:"ing9",q:100}]},
  {id:39,name:"Aloo Matar",             cat:"Curries",            price:140, recipe:[{i:"ing6",q:150},{i:"ing24",q:80}]},
  {id:40,name:"Aloo Gobi",              cat:"Curries",            price:130, recipe:[{i:"ing6",q:150},{i:"ing15",q:100}]},
  {id:41,name:"Mix Veg",                cat:"Curries",            price:180, recipe:[{i:"ing6",q:60},{i:"ing15",q:60},{i:"ing24",q:60},{i:"ing9",q:80}]},
  {id:42,name:"Veg Kolhapuri",          cat:"Curries",            price:190, recipe:[{i:"ing6",q:60},{i:"ing8",q:60},{i:"ing9",q:80},{i:"ing30",q:15}]},
  {id:43,name:"Dal Makhani",            cat:"Dals",               price:180, recipe:[{i:"ing14",q:100},{i:"ing18",q:20},{i:"ing9",q:60}]},
  {id:44,name:"Dal Tadka",              cat:"Dals",               price:160, recipe:[{i:"ing14",q:100},{i:"ing11",q:15},{i:"ing8",q:30}]},
  {id:45,name:"Dal Fry",                cat:"Dals",               price:150, recipe:[{i:"ing14",q:100},{i:"ing10",q:20},{i:"ing9",q:40}]},
  {id:46,name:"Sev Tamatar",            cat:"Rajasthani Special", price:170, recipe:[{i:"ing9",q:150},{i:"ing30",q:10}]},
  {id:47,name:"Dudh Sev Tamatar",       cat:"Rajasthani Special", price:180, recipe:[{i:"ing9",q:100},{i:"ing1",q:100},{i:"ing30",q:10}]},
  {id:48,name:"Besan Kadhi",            cat:"Rajasthani Special", price:150, recipe:[{i:"ing19",q:150},{i:"ing30",q:8}]},
  {id:49,name:"Jaipuriya Papad",        cat:"Rajasthani Special", price:190, recipe:[{i:"ing30",q:10},{i:"ing8",q:20}]},
  {id:50,name:"Dal Bati Churma Thali",  cat:"Rajasthani Special", price:250, recipe:[{i:"ing14",q:80},{i:"ing12",q:100},{i:"ing11",q:30},{i:"ing29",q:50}]},
  {id:51,name:"Roti",                   cat:"Breads",             price:20,  recipe:[{i:"ing12",q:40}]},
  {id:52,name:"Ghee Roti",              cat:"Breads",             price:25,  recipe:[{i:"ing12",q:40},{i:"ing11",q:10}]},
  {id:53,name:"Jeera Rice",             cat:"Rice",               price:150, recipe:[{i:"ing13",q:150},{i:"ing11",q:10}]},
  {id:54,name:"Curd Rice",              cat:"Rice",               price:170, recipe:[{i:"ing13",q:150},{i:"ing19",q:100}]},
  {id:55,name:"Ghee Rice",              cat:"Rice",               price:190, recipe:[{i:"ing13",q:150},{i:"ing11",q:20}]},
  {id:56,name:"Veg Fried Rice",         cat:"Rice",               price:180, recipe:[{i:"ing13",q:150},{i:"ing8",q:40},{i:"ing10",q:20}]},
  {id:57,name:"Paneer Fried Rice",      cat:"Rice",               price:210, recipe:[{i:"ing13",q:150},{i:"ing7",q:80},{i:"ing10",q:20}]},
  {id:58,name:"Tea",                    cat:"Hot Beverages",      price:15,  recipe:[{i:"ing1",q:150},{i:"ing3",q:5},{i:"ing2",q:15}]},
  {id:59,name:"Lemon Tea",              cat:"Hot Beverages",      price:20,  recipe:[{i:"ing1",q:100},{i:"ing3",q:5},{i:"ing5",q:0.5},{i:"ing2",q:10}]},
  {id:60,name:"Coffee",                 cat:"Hot Beverages",      price:20,  recipe:[{i:"ing1",q:150},{i:"ing4",q:8},{i:"ing2",q:15}]},
  {id:61,name:"Cold Coffee",            cat:"Cold Beverages",     price:80,  recipe:[{i:"ing1",q:200},{i:"ing4",q:10},{i:"ing2",q:20}]},
  {id:62,name:"Cold Coffee with Icecream",cat:"Cold Beverages",   price:100, recipe:[{i:"ing1",q:200},{i:"ing4",q:10},{i:"ing28",q:1},{i:"ing2",q:15}]},
  {id:63,name:"Iced Tea",               cat:"Cold Beverages",     price:80,  recipe:[{i:"ing1",q:100},{i:"ing3",q:5},{i:"ing5",q:0.5},{i:"ing2",q:10}]},
  {id:64,name:"Butter Milk",            cat:"Cold Beverages",     price:30,  recipe:[{i:"ing19",q:200},{i:"ing30",q:3}]},
  {id:65,name:"Lassi",                  cat:"Cold Beverages",     price:80,  recipe:[{i:"ing19",q:200},{i:"ing2",q:20}]},
  {id:66,name:"Dry Fruit Lassi",        cat:"Cold Beverages",     price:90,  recipe:[{i:"ing19",q:200},{i:"ing25",q:20},{i:"ing2",q:15}]},
  {id:67,name:"Lemonade",               cat:"Cold Beverages",     price:50,  recipe:[{i:"ing5",q:1},{i:"ing2",q:20},{i:"ing27",q:150}]},
  {id:68,name:"Mint Mojito",            cat:"Cold Beverages",     price:120, recipe:[{i:"ing26",q:10},{i:"ing5",q:0.5},{i:"ing27",q:150},{i:"ing2",q:15}]},
  {id:69,name:"Blue Lagoon",            cat:"Cold Beverages",     price:140, recipe:[{i:"ing27",q:200},{i:"ing5",q:0.5},{i:"ing2",q:20}]},
  {id:70,name:"Churma",                 cat:"Desserts",           price:50,  recipe:[{i:"ing12",q:80},{i:"ing29",q:40},{i:"ing11",q:15}]},
  {id:71,name:"Shahi Crunch",           cat:"Desserts",           price:180, recipe:[{i:"ing12",q:80},{i:"ing28",q:1},{i:"ing29",q:30}]},
  {id:72,name:"Sindhi Gurari",          cat:"Desserts",           price:190, recipe:[{i:"ing12",q:80},{i:"ing29",q:50},{i:"ing11",q:20}]},
  {id:73,name:"Sindhi Shahi Gurari",    cat:"Desserts",           price:199, recipe:[{i:"ing12",q:80},{i:"ing29",q:50},{i:"ing25",q:20},{i:"ing11",q:20}]},
];


const DEFAULT_CATS = ["Quick Bites","Desi Starters","Chinese Starters","Parathas","Curries","Dals","Rajasthani Special","Breads","Rice","Hot Beverages","Cold Beverages","Desserts"];
const CATS = DEFAULT_CATS; // alias used in billing sticky bar + activeCat init
const TABLE_COUNT = 12;
const EDIT_TABLE_ID = 0; // virtual table for bill editing — never synced to Firebase

const C = {
  bg:"#f5f0e8", surface:"#ede7d9", card:"#ffffff", border:"#d6ccb8",
  accent:"#b85c00", accentD:"#8f4500", text:"#1a1208", muted:"#7a6a50",
  success:"#2e7d4f", danger:"#c0392b", info:"#1a6fa8", warn:"#c07800",
};

// Inject global CSS once
(function(){
  if(document.getElementById("kaka-global-css")) return;
  const s=document.createElement("style");
  s.id="kaka-global-css";
  s.textContent=`
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=DM+Sans:wght@400;600;700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#f5f0e8;color:#1a1208;font-family:'DM Sans',sans-serif;font-size:14px}
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-track{background:#ede7d9}
    ::-webkit-scrollbar-thumb{background:#d6ccb8;border-radius:2px}
    input,select,textarea{background:#ede7d9;border:1px solid #d6ccb8;color:#1a1208;padding:9px 13px;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:13px;outline:none;width:100%;transition:border-color .15s}
    input:focus,select:focus,textarea:focus{border-color:#b85c00}
    button{cursor:pointer;font-family:'DM Sans',sans-serif}
    @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideIn{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}
    @keyframes popIn{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
    .fade-up{animation:fadeUp .22s ease}
    .blink{animation:blink 1.2s ease 4}
    @media screen{#kaka-bill-print{position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden}}
    @media print{*{visibility:hidden!important}#kaka-bill-print,#kaka-bill-print *{visibility:visible!important}#kaka-bill-print{position:fixed!important;left:0!important;top:0!important;width:100%!important;height:auto!important;background:#fff!important;padding:24px 20px!important;font-family:monospace!important;font-size:13px!important;color:#111!important;overflow:visible!important}}
    /* ── Responsive ── */
    .billing-layout{display:flex;gap:16px;align-items:flex-start}
    .billing-menu{flex:1;min-width:0}
    .billing-cart{width:320px;flex-shrink:0;position:sticky;top:108px}
    /* Mobile: menu fills width, cart is a fixed bottom drawer */
    @media(max-width:768px){
      .billing-layout{display:block}
      .billing-menu{width:100%;padding-bottom:60px}
      .billing-cart{
        display:none; /* hidden by default — shown via JS as drawer */
      }
      .billing-cart-drawer{
        position:fixed;bottom:0;left:0;right:0;z-index:500;
        background:#fff;border-radius:16px 16px 0 0;
        box-shadow:0 -4px 24px #0003;
        transition:transform .3s ease;
        max-height:85vh;
        overflow:hidden;
        display:flex;flex-direction:column;
      }
      .billing-cart-drawer.closed{transform:translateY(calc(100% - 52px))}
      .billing-cart-drawer.open{transform:translateY(0)}
      .drawer-handle{
        padding:10px 16px;cursor:pointer;
        display:flex;justify-content:space-between;align-items:center;
        background:#f5f0e8;border-radius:16px 16px 0 0;
        border-bottom:1px solid #d6ccb8;flex-shrink:0;
      }
      .drawer-body{overflow-y:auto;flex:1;padding:12px}
    }
    @media(min-width:769px){
      .billing-cart-drawer{display:none!important}
    }
  `;
  document.head.appendChild(s);
})();

const fmt = n => "₹"+Number(n).toLocaleString("en-IN");

// Activity log — stores last 100 events in localStorage for debugging
const addLog = (action, detail="") => {
  try {
    const logs = JSON.parse(localStorage.getItem("kaka_log")||"[]");
    logs.unshift({t: new Date().toLocaleString("en-IN"), action, detail});
    localStorage.setItem("kaka_log", JSON.stringify(logs.slice(0,100)));
  } catch(e) {}
};
const nowStr = () => new Date().toLocaleString("en-IN",{hour12:true});
const todayStr = () => new Date().toLocaleDateString("en-IN");

const sendWhatsApp = (phone, msg) => {
  const encoded = encodeURIComponent(msg);
  // wa.me link: on desktop opens WhatsApp desktop app if installed,
  // otherwise opens WhatsApp Web. On mobile opens WhatsApp app directly.
  // This is the same link WhatsApp officially recommends for sharing.
  const url = `https://wa.me/91${phone}?text=${encoded}`;
  window.open(url, "kaka_wa");
};

// ── Tiny UI Components ────────────────────────────────────────────────────────
function Btn({children,onClick,v="primary",size="md",full,disabled,style:sx={}}) {
  const p=size==="sm"?"5px 11px":size==="lg"?"12px 26px":"8px 16px";
  const f=size==="sm"?12:size==="lg"?15:13;
  const V={
    primary:{background:C.accent,color:"#fff"},
    danger:{background:C.danger,color:"#fff"},
    success:{background:C.success,color:"#fff"},
    ghost:{background:"transparent",color:C.accent,border:`1px solid ${C.accent}44`},
    muted:{background:C.border,color:C.text},
    dark:{background:C.surface,color:C.muted,border:`1px solid ${C.border}`},
    warn:{background:C.warn,color:"#fff"},
  };
  return <button disabled={disabled} onClick={onClick}
    style={{padding:p,fontSize:f,fontWeight:600,borderRadius:8,border:"none",
      width:full?"100%":"auto",opacity:disabled?.45:1,cursor:disabled?"not-allowed":"pointer",
      transition:"filter .12s,transform .1s",...V[v],...sx}}
    onMouseEnter={e=>{if(!disabled)e.currentTarget.style.filter="brightness(1.13)"}}
    onMouseLeave={e=>{e.currentTarget.style.filter=""}}
    onMouseDown={e=>{if(!disabled)e.currentTarget.style.transform="scale(.97)"}}
    onMouseUp={e=>{e.currentTarget.style.transform=""}}>
    {children}
  </button>;
}
function Card({children,style:sx={},onClick}) {
  return <div onClick={onClick} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:14,...sx,cursor:onClick?"pointer":"default"}}>{children}</div>;
}
function Modal({title,children,onClose,width=480}) {
  return (
    <div style={{position:"fixed",inset:0,background:"#00000099",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:C.card,border:`1px solid ${C.border}66`,borderRadius:16,width:"100%",maxWidth:width,maxHeight:"92vh",overflowY:"auto",animation:"popIn .18s ease",boxShadow:"0 24px 60px #00000088"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"18px 22px",borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontFamily:"Playfair Display",fontSize:18,fontWeight:700}}>{title}</span>
          <Btn v="muted" size="sm" onClick={onClose}>✕</Btn>
        </div>
        <div style={{padding:22}}>{children}</div>
      </div>
    </div>
  );
}
function Toast({msg,type}) {
  const bg=type==="danger"?C.danger:type==="info"?C.info:type==="warn"?C.warn:C.success;
  return <div style={{position:"fixed",bottom:24,right:24,zIndex:9999,background:bg,color:"#fff",padding:"11px 20px",borderRadius:10,fontWeight:600,fontSize:13,boxShadow:"0 6px 24px #0007",animation:"slideIn .25s ease"}}>{msg}</div>;
}

// ── Staff PIN Gate ────────────────────────────────────────────────────────────
function StaffGate({onUnlock}) {
  const [pin,setPin]=useState("");
  const [err,setErr]=useState(false);
  const [correctPin,setCorrectPin]=useState("0000");

  useEffect(()=>{
    // Already unlocked this session (page refresh) — skip PIN
    if(sessionStorage.getItem("kaka_unlocked")==="1"){ onUnlock(); return; }
    fetch(`${FB}/cafes/kaka-main/settings/staffPin.json`)
      .then(r=>r.json())
      .then(v=>{ if(v && typeof v==="string" && v.length===4) setCorrectPin(v); })
      .catch(()=>{});
  },[]);

  const addDigit=(d)=>{
    const next=pin+d;
    setPin(next);
    if(next.length===4){
      if(next===(correctPin||"0000")){
        sessionStorage.setItem("kaka_unlocked","1");
        onUnlock();
      } else {
        setErr(true);
        setTimeout(()=>{ setErr(false); setPin(""); },800);
      }
    }
  };

  return (
    <div style={{minHeight:"100vh",background:"#1a1208",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"DM Sans,sans-serif",padding:24}}>
      <div style={{background:"#2a1f10",borderRadius:20,padding:"40px 32px",width:"100%",maxWidth:340,textAlign:"center",boxShadow:"0 24px 60px #00000099",border:"1px solid #3a2f20"}}>
        <div style={{fontSize:48,marginBottom:12}}>☕</div>
        <div style={{fontFamily:"Playfair Display",fontSize:26,color:"#f5c842",fontWeight:800,marginBottom:4}}>Kaka Cafe</div>
        <div style={{fontSize:13,color:"#a08060",marginBottom:28}}>Staff Access Only</div>
        <div style={{display:"flex",justifyContent:"center",gap:10,marginBottom:24}}>
          {[0,1,2,3].map(i=>(
            <div key={i} style={{width:18,height:18,borderRadius:"50%",
              border:"2px solid "+(err?"#c0392b":pin.length>i?"#f5c842":"#5a4030"),
              background:pin.length>i?(err?"#c0392b":"#f5c842"):"transparent",
              transition:"all .15s"}}/>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:10}}>
          {[1,2,3,4,5,6,7,8,9].map(n=>(
            <button key={n} onClick={()=>addDigit(String(n))}
              style={{padding:"16px",fontSize:20,fontWeight:700,borderRadius:12,
                border:"1px solid #3a2f20",background:"#2a1f10",color:"#f2ead6",cursor:"pointer"}}
              onMouseDown={e=>e.currentTarget.style.background="#3a2f20"}
              onMouseUp={e=>e.currentTarget.style.background="#2a1f10"}>{n}</button>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <div/>
          <button onClick={()=>addDigit("0")}
            style={{padding:"16px",fontSize:20,fontWeight:700,borderRadius:12,border:"1px solid #3a2f20",background:"#2a1f10",color:"#f2ead6",cursor:"pointer"}}>0</button>
          <button onClick={()=>setPin(p=>p.slice(0,-1))}
            style={{padding:"16px",fontSize:16,borderRadius:12,border:"1px solid #3a2f20",background:"#2a1f10",color:"#a08060",cursor:"pointer"}}>⌫</button>
        </div>
        {err && <div style={{marginTop:16,color:"#e74c3c",fontWeight:700,fontSize:13}}>Wrong PIN — try again</div>}
        <div style={{marginTop:20,fontSize:11,color:"#5a4030"}}>Default PIN: 0000</div>
      </div>
    </div>
  );
}

// ── Menu Item Card ────────────────────────────────────────────────────────────
function MCard({item,cart,onAdd}) {
  const inC=cart.find(c=>c.id===item.id);
  return (
    <div onClick={()=>onAdd(item)}
      style={{background:C.card,border:`1.5px solid ${inC?C.accent+"99":C.border}`,borderRadius:10,
        padding:"10px 11px",cursor:"pointer",position:"relative",transition:"border-color .12s"}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent+"bb"}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=inC?C.accent+"99":C.border}}>
      <div style={{fontSize:13,fontWeight:600,lineHeight:1.3,marginBottom:5}}>{item.name}</div>
      <div style={{fontWeight:800,color:C.accent,fontSize:14}}>{fmt(item.price)}</div>
      {inC && <div style={{position:"absolute",top:5,right:5,background:C.accent,color:"#fff",borderRadius:"50%",width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800}}>{inC.qty}</div>}
    </div>
  );
}

// ── QR Modal ─────────────────────────────────────────────────────────────────
function QRModal({tableId,info,onClose}) {
  const [copied,setCopied]=useState(false);
  const isValidUrl=s=>{try{const u=new URL(s);return u.protocol==="http:"||u.protocol==="https:";}catch(e){return false;}};
  const savedBase=(info?.publicUrl||"").trim().replace(/\/+$/,"");
  const base=isValidUrl(savedBase)?savedBase:"";
  const isPublic=base&&!savedBase.includes("192.")&&!savedBase.includes("localhost");
  const token=encodeQRToken(tableId);
  // Use hash (#token) so URL looks like: yourcafe.pages.dev#mX7kQp2
  // No "?o=" visible, harder to guess or tamper with
  const finalUrl=base?`${base}#${token}`:"";
  const qrSrc=finalUrl?`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(finalUrl)}`:"";
  const copyUrl=()=>{
    if(!finalUrl) return;
    navigator.clipboard.writeText(finalUrl).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2500);});
  };
  return (
    <Modal title={"QR Code · Table "+tableId} onClose={onClose} width={420}>
      <div style={{textAlign:"center"}}>
        {!base ? (
          <div style={{background:C.danger+"10",border:`1.5px solid ${C.danger}44`,borderRadius:10,padding:16,textAlign:"left"}}>
            <div style={{fontWeight:800,color:C.danger,marginBottom:8}}>No public URL set</div>
            <div style={{fontSize:12,color:C.muted}}>Go to Settings → enter your Public URL to generate QR codes.</div>
          </div>
        ) : (
          <>
            <div style={{background:"#fff",padding:16,borderRadius:12,display:"inline-block",marginBottom:10,boxShadow:"0 2px 16px #0002"}}>
              <img src={qrSrc} alt={"QR Table "+tableId} width={240} height={240} style={{display:"block"}}/>
            </div>
            <div style={{background:C.surface,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.muted,marginBottom:6,textAlign:"center"}}>
              Scan to Order
            </div>
            {isPublic
              ? <div style={{background:C.success+"18",border:`1px solid ${C.success}44`,borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12,color:C.success,fontWeight:700}}>✅ Public URL — works from any phone</div>
              : <div style={{background:C.warn+"18",border:`1px solid ${C.warn}55`,borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12,color:"#7a5500",textAlign:"left"}}>⚠ Local WiFi only</div>
            }
            <div style={{display:"flex",gap:8}}>
              <button onClick={copyUrl}
                style={{flex:1,background:copied?C.success:"transparent",color:copied?"#fff":C.muted,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px",fontWeight:600,fontSize:12,cursor:"pointer"}}>
                {copied?"✓ Copied!":"📋 Copy URL"}
              </button>
              <button onClick={()=>window.print()}
                style={{flex:1,background:C.accent,color:"#fff",border:"none",borderRadius:8,padding:"10px",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                🖨 Print QR
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Customer QR View (for customer phones) ────────────────────────────────────
function CustomerView({tableId}) {
  const [step,setStep]=useState("info");
  const [custName,setCustName]=useState("");
  const [custPhone,setCustPhone]=useState("");
  const [cart,setCart]=useState([]);
  const [cat,setCat]=useState("All");
  const [note,setNote]=useState("");
  const [done,setDone]=useState(false);
  const [submitting,setSubmitting]=useState(false);

  const allCats=["All",...DEFAULT_CATS];
  const items=cat==="All"?INITIAL_MENU:INITIAL_MENU.filter(i=>i.cat===cat);
  const addItem=item=>{
    setCart(c=>{
      const ex=c.find(x=>x.id===item.id);
      if(ex) return c.map(x=>x.id===item.id?{...x,qty:x.qty+1}:x);
      return [...c,{...item,qty:1}];
    });
  };
  const removeItem=id=>setCart(c=>{
    const ex=c.find(x=>x.id===id);
    if(!ex) return c;
    if(ex.qty===1) return c.filter(x=>x.id!==id);
    return c.map(x=>x.id===id?{...x,qty:x.qty-1}:x);
  });
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);

  const submit=async()=>{
    if(!custName.trim()||custPhone.length<10){alert("Please enter your name and 10-digit phone.");return;}
    if(!cart.length){alert("Add at least one item.");return;}
    setSubmitting(true);
    try{
      const order={tableId,items:cart,note,time:new Date().toLocaleTimeString(),id:Date.now(),custName:custName.trim(),custPhone,_ts:Date.now()};
      const r=await fetch(`${FB}/cafes/kaka-main/qrOrders.json`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(order)});
      if(!r.ok) throw new Error("Failed");
      setDone(true);
    } catch(e){alert("Could not place order. Please call staff.");} finally{setSubmitting(false);}
  };

  if(done) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"DM Sans,sans-serif",textAlign:"center"}}>
      <div style={{fontSize:64,marginBottom:16}}>🎉</div>
      <div style={{fontFamily:"Playfair Display",fontSize:24,marginBottom:8}}>Order Placed!</div>
      <div style={{color:C.muted,fontSize:14,marginBottom:8}}>Your order has been sent to the kitchen. Please wait.</div>
      <div style={{color:C.muted,fontSize:13,marginBottom:24}}>Want to add more items?</div>
      <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:280}}>
        <button onClick={()=>{setCart([]);setNote("");setDone(false);}} style={{padding:"14px",borderRadius:10,border:"none",background:C.accent,color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer"}}>🍽 Order More Items</button>
        <button onClick={()=>{setCart([]);setNote("");setDone(false);setStep("info");}} style={{padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.surface,fontWeight:600,fontSize:14,cursor:"pointer",color:C.muted}}>← Back to Start</button>
      </div>
    </div>
  );

  if(step==="info") return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"DM Sans,sans-serif"}}>
      <div style={{background:C.surface,padding:"20px",textAlign:"center",borderBottom:`1px solid ${C.border}`}}>
        <div style={{fontFamily:"Playfair Display",fontSize:22,color:C.accent}}>Kaka Cafe</div>
        <div style={{fontSize:12,color:C.muted}}>Bengaluru, Karnataka</div>
      </div>
      <div style={{padding:24,maxWidth:400,margin:"0 auto"}}>
        <div style={{fontFamily:"Playfair Display",fontSize:18,marginBottom:20}}>Welcome! Tell us who you are</div>
        <div style={{marginBottom:14}}>
          <label style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:.6}}>Your Name</label>
          <input style={{marginTop:6}} value={custName} onChange={e=>setCustName(e.target.value)} placeholder="e.g. Raj"/>
        </div>
        <div style={{marginBottom:24}}>
          <label style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:.6}}>Phone Number</label>
          <input style={{marginTop:6}} type="tel" maxLength={10} value={custPhone} onChange={e=>setCustPhone(e.target.value.replace(/\D/g,"").slice(0,10))} placeholder="10-digit mobile number"/>
        </div>
        <Btn full size="lg" onClick={()=>{if(!custName.trim()||custPhone.length<10){alert("Enter name and 10-digit phone");return;}setStep("menu");}}>
          View Menu →
        </Btn>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"DM Sans,sans-serif",paddingBottom:140}}>
      <div style={{background:C.surface,padding:"14px 20px",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:10}}>
        <div style={{fontFamily:"Playfair Display",fontSize:18,color:C.accent}}>Kaka Cafe</div>
        <div style={{fontSize:12,color:C.muted}}>Hi {custName}! Browse and add items.</div>
      </div>
      <div style={{display:"flex",gap:6,padding:"10px 16px",overflowX:"auto",background:C.surface,borderBottom:`1px solid ${C.border}`}}>
        {allCats.map(c=>(
          <button key={c} onClick={()=>setCat(c)}
            style={{padding:"6px 14px",borderRadius:20,border:"none",background:cat===c?C.accent:"transparent",
              color:cat===c?"#fff":C.muted,fontWeight:600,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
            {c}
          </button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,padding:16}}>
        {items.map(item=>{
          const inC=cart.find(x=>x.id===item.id);
          return (
            <div key={item.id} style={{background:C.card,border:`1.5px solid ${inC?C.accent+"88":C.border}`,borderRadius:10,padding:12}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:6,lineHeight:1.3}}>{item.name}</div>
              <div style={{fontWeight:800,color:C.accent,marginBottom:8}}>{fmt(item.price)}</div>
              {inC ? (
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <button onClick={()=>removeItem(item.id)} style={{width:28,height:28,borderRadius:"50%",border:`1px solid ${C.border}`,background:C.surface,fontWeight:800,cursor:"pointer",fontSize:16}}>−</button>
                  <span style={{fontWeight:700,minWidth:20,textAlign:"center"}}>{inC.qty}</span>
                  <button onClick={()=>addItem(item)} style={{width:28,height:28,borderRadius:"50%",border:"none",background:C.accent,color:"#fff",fontWeight:800,cursor:"pointer",fontSize:16}}>+</button>
                </div>
              ) : (
                <button onClick={()=>addItem(item)} style={{width:"100%",padding:"6px",borderRadius:8,border:"none",background:C.accent,color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer"}}>+ Add</button>
              )}
            </div>
          );
        })}
      </div>
      {cart.length>0 && (
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.card,borderTop:`1px solid ${C.border}`,padding:16,boxShadow:"0 -4px 20px #0002"}}>
          <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Any special requests? (optional)" rows={1}
            style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,fontSize:12,resize:"none",marginBottom:10,fontFamily:"DM Sans,sans-serif"}}/>
          <button onClick={submit} disabled={submitting}
            style={{width:"100%",padding:"14px",borderRadius:10,border:"none",background:C.accent,color:"#fff",fontWeight:800,fontSize:16,cursor:"pointer"}}>
            {submitting?"Placing Order...":"Place Order · "+fmt(total)}
          </button>
        </div>
      )}
    </div>
  );
}



// ── Customer App export (for QR links) ───────────────────────────────────────
export function CustomerApp() {
  const params = new URLSearchParams(window.location.search);
  // Support both ?o= (query) and #token (hash) formats
  const hashToken = window.location.hash.replace(/^#/,"");
  const token = params.get("o") || hashToken || null;
  const tableId = token ? decodeQRToken(token) : parseInt(params.get("table")||"0");
  if(!tableId) return (
    <div style={{minHeight:"100vh",background:"#1a1208",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"DM Sans,sans-serif"}}>
      <div style={{textAlign:"center",color:"#a08060",padding:40}}>
        <div style={{fontSize:40,marginBottom:12}}>☕</div>
        <div style={{fontSize:18,fontWeight:700,color:"#f5c842",marginBottom:8}}>Kaka Cafe</div>
        <div style={{fontSize:13}}>Please scan the QR code on your table to order.</div>
      </div>
    </div>
  );
  return <CustomerView tableId={tableId}/>;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════════════════
export default function App() {
  // ── State ─────────────────────────────────────────────────────────────────
  const [staffUnlocked,setStaffUnlocked]=useState(()=>sessionStorage.getItem("kaka_unlocked")==="1");
  const staffUnlockedRef=useRef(sessionStorage.getItem("kaka_unlocked")==="1"); // readable inside callbacks
  const pendingOrderRef=useRef(null); // orders that arrive before PIN entered — shown after unlock

  const [tab,setTab]=useState("billing");
  const [menu,setMenu]=useState(INITIAL_MENU);
  const [cats,setCats]=useState(()=>{try{const s=localStorage.getItem("kaka_cats");return s?JSON.parse(s):DEFAULT_CATS;}catch(e){return DEFAULT_CATS;}});
  const saveCats=c=>{setCats(c);try{localStorage.setItem("kaka_cats",JSON.stringify(c));}catch(e){}};
  const saveMenu=(m)=>{
    setMenu(m);
    // Save each item keyed by id so Firebase merges cleanly
    const obj={}; m.forEach(item=>{ obj[String(item.id)]=item; });
    fbSet("menu",obj);
  };
  const [editItem,setEditItem]=useState(null); // {id,name,price,cat}
  const [newCatName,setNewCatName]=useState("");
  const [ings,setIngs]=useState(INITIAL_INGREDIENTS);
  const [bills,setBills]=useState([]);
  const [info,setInfo]=useState({...DEFAULT_INFO, publicUrl:(()=>{try{return localStorage.getItem("kaka_public_url")||"";}catch(e){return "";}})()});
  const [tables,setTables]=useState(Array.from({length:TABLE_COUNT},(_,i)=>({id:i+1,status:"free",order:[]})));
  const [qrOrders,setQrOrders]=useState([]);
  const [customers,setCustomers]=useState([]);
  const [custSearch,setCustSearch]=useState("");
  const [editCust,setEditCust]=useState(null);
  const [selTable,setSelTable]=useState(1);
  const [cart,setCart]=useState([]);
  const [search,setSearch]=useState("");
  const [activeCat,setActiveCat]=useState(CATS[0]);
  const [billN,setBillN]=useState(1001);
  const [toast,setToast]=useState(null);
  const [diagData,setDiagData]=useState(null); // raw Firebase diagnostic
  const [printBill,setPrintBill]=useState(null);
  const [billFilter,setBillFilter]=useState("all"); // all | today | yesterday | custom
  const [billDateFrom,setBillDateFrom]=useState(()=>new Date().toISOString().slice(0,10));
  const [billDateTo,setBillDateTo]=useState(()=>new Date().toISOString().slice(0,10));
  const [billSort,setBillSort]=useState("newest"); // newest | oldest | highest | lowest
  const [editBill,setEditBill]=useState(null); // {id, items, paymentMode, custName, ...}
  const [editBillOpen,setEditBillOpen]=useState(false);
  const [contactsResult,setContactsResult]=useState(null); // parsed contacts sync result
  const [contactsLoading,setContactsLoading]=useState(false);
  const [modal,setModal]=useState(null);
  const [mdata,setMdata]=useState(null);
  const [rRange,setRRange]=useState("today");
  const [customFrom,setCustomFrom]=useState(()=>new Date().toISOString().slice(0,10));
  const [customTo,setCustomTo]=useState(()=>new Date().toISOString().slice(0,10));
  const [qrView,setQrView]=useState(null);
  const [newItem,setNewItem]=useState({name:"",cat:"Quick Bites",price:""});
  const [newIng,setNewIng]=useState({name:"",unit:"g",stock:"",low:""});
  const scrollRef=useRef(null);
  const catRefs=useRef({});
  const [applyGST,setApplyGST]=useState(false);
  const [quickItem,setQuickItem]=useState({name:"",price:""});
  const [packaging,setPackaging]=useState(0);
  const [cartDrawerOpen,setCartDrawerOpen]=useState(true); // mobile cart drawer
  const [billCustName,setBillCustName]=useState("");
  const [billCustPhone,setBillCustPhone]=useState("");
  const [mixPay,setMixPay]=useState({cash:"",upi:""});
  const [showMix,setShowMix]=useState(false);
  const [serverOk,setServerOk]=useState(null);
  const [firebaseBlocked,setFirebaseBlocked]=useState(false);
  const [incomingOrder,setIncomingOrder]=useState(null);
  const [isAdmin,setIsAdmin]=useState(false);
  const [adminModal,setAdminModal]=useState(false);
  const [adminInput,setAdminInput]=useState("");
  // On app start, fetch existing qrOrder keys → mark all as "already seen"
  // After that, any NEW key in Firebase = genuinely new customer order → show popup
  const seenOrderKeys = useRef(new Set());
  const seenOrdersInitialized = useRef(false);
  const markOrderSeen = (k) => { seenOrderKeys.current.add(k); };
  // Tables we freed locally — ignore Firebase "occupied" echo for 6s after freeing
  const recentlyFreed = useRef(new Set());
  const tableSettings = useRef({}); // per-table {packaging, applyGST} memory
  const markTableFreed = (id) => {
    recentlyFreed.current.add(id);
    setTimeout(()=>recentlyFreed.current.delete(id), 6000);
  };

  // ── Expenditure ───────────────────────────────────────────────────────────
  const [expenses,setExpenses]=useState([]);
  const [expCats,setExpCats]=useState(()=>{try{const s=localStorage.getItem("kaka_exp_cats");return s?JSON.parse(s):["Raw Materials","Salaries","Rent","Utilities","Maintenance","Packaging","Other"];}catch(e){return ["Raw Materials","Salaries","Rent","Utilities","Maintenance","Packaging","Other"];}});
  const [newExp,setNewExp]=useState({cat:"Raw Materials",desc:"",amount:""});
  const [expFilter,setExpFilter]=useState("today");
  const [expCustomFrom,setExpCustomFrom]=useState(()=>new Date().toISOString().slice(0,10));
  const [expCustomTo,setExpCustomTo]=useState(()=>new Date().toISOString().slice(0,10));
  const saveExpCats=c=>{setExpCats(c);try{localStorage.setItem("kaka_exp_cats",JSON.stringify(c));}catch(e){}};

  const notify=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),3000);};

  // ── Audio beep ────────────────────────────────────────────────────────────
  const playBeep=useCallback(()=>{
    try{
      const a=new (window.AudioContext||window.webkitAudioContext)();
      [880,1100].forEach((freq,i)=>{
        const osc=a.createOscillator(),g=a.createGain();
        osc.connect(g);g.connect(a.destination);
        osc.frequency.value=freq;osc.type="sine";
        g.gain.setValueAtTime(0,a.currentTime+i*0.15);
        g.gain.linearRampToValueAtTime(0.4,a.currentTime+i*0.15+0.02);
        g.gain.linearRampToValueAtTime(0,a.currentTime+i*0.15+0.25);
        osc.start(a.currentTime+i*0.15);osc.stop(a.currentTime+i*0.15+0.3);
      });
    }catch(e){}
  },[]);

  // ── Firebase sync ─────────────────────────────────────────────────────────
  useEffect(()=>{
    let pingTimer;
    const unsubs=[];
    // Tables: poll every 4s instead of SSE — avoids race conditions from concurrent writes
    const syncTables = () =>
      fetch(`${FB_BASE}/tables.json`,{cache:"no-store"})
        .then(r=>r.json()).then(data=>{
          if(!data) return;
          setTables(prev=>prev.map(t=>{
            const d=data[String(t.id)];
            // Don't overwrite a table we freed in the last 6s — our write is fresher
            if(recentlyFreed.current.has(t.id)){
              if(d && d.status==="occupied") return t; // ignore stale occupied from Firebase
            }
            return d ? {...d,id:t.id} : {id:t.id,status:"free",order:[]};
          }));
        }).catch(()=>{});
    syncTables();
    const tablesPollTimer = setInterval(syncTables, 4000);
    unsubs.push(()=>clearInterval(tablesPollTimer));
    // ── Load all data immediately on mount (no waiting for poll interval) ──
    // Validate Firebase response — reject error objects and non-record data
    const isValidFbData = (d) => d && typeof d==="object" && !Array.isArray(d) && !d.error;

    const processBills = (data) => {
      if(!isValidFbData(data)) {
        // Firebase blocked — load from localStorage cache
        try {
          const cached = localStorage.getItem("kaka_bills_cache");
          if(cached) { setBills(JSON.parse(cached)); }
        } catch(e) {}
        return;
      }
      const arr=Object.entries(data)
        .filter(([k,v])=>v && typeof v==="object" && v.billNo)
        .map(([k,v])=>({...v,_fbKey:k}))
        .sort((a,b)=>{
          const na=parseInt(String(a.billNo).replace(/\D/g,"")||0);
          const nb=parseInt(String(b.billNo).replace(/\D/g,"")||0);
          return nb-na;
        });
      setBills(arr);
      if(arr.length) {
        setBillN(Math.max(...arr.map(b=>parseInt(String(b.billNo).replace(/\D/g,"")||1001)))+1);
        // Cache to localStorage for offline fallback
        try { localStorage.setItem("kaka_bills_cache", JSON.stringify(arr)); } catch(e) {}
      }
    };

    const processMenu = (data) => {
      if(!isValidFbData(data)) return; // keep INITIAL_MENU if Firebase fails
      const arr=Object.values(data).filter(v=>v && typeof v==="object" && v.name && v.price);
      if(arr.length >= 1) setMenu(arr); // only override if we got real menu items
    };

    const processCustomers = (data) => {
      if(!isValidFbData(data)) return;
      const arr=Object.values(data).filter(v=>v && typeof v==="object" && v.phone);
      setCustomers(arr.sort((a,b)=>(b.visits||0)-(a.visits||0)));
    };

    const processSettings = (data) => {
      if(!isValidFbData(data)) return;
      // Accept if it has ANY known settings field
      const knownFields = ['adminPass','staffPin','name','upiId','phone','publicUrl','kitchenPhone'];
      if(!knownFields.some(f=>f in data)) return;
      setInfo(prev=>({...prev,...data, publicUrl:data.publicUrl||prev.publicUrl||""}));
    };

    const loadAll = async () => {
      try {
        const [billsData, menuData, custData, settingsData] = await Promise.all([
          fetch(`${FB_BASE}/bills.json`,{cache:"no-store"}).then(r=>r.json()).catch(()=>null),
          fetch(`${FB_BASE}/menu.json`,{cache:"no-store"}).then(r=>r.json()).catch(()=>null),
          fetch(`${FB_BASE}/customers.json`,{cache:"no-store"}).then(r=>r.json()).catch(()=>null),
          fetch(`${FB_BASE}/settings.json`,{cache:"no-store"}).then(r=>r.json()).catch(()=>null),
        ]);
        processBills(billsData);
        processMenu(menuData);
        processCustomers(custData);
        processSettings(settingsData);
        // Check if Firebase responded properly
        // Check for permission denied — Firebase rules locked
        const permDenied = [billsData, menuData, custData, settingsData]
          .some(d=>d && d.error && d.error.toLowerCase().includes("permission"));
        if(permDenied){
          setServerOk(false);
          setFirebaseBlocked(true);
        } else {
          setFirebaseBlocked(false);
          const fbOk = [billsData, menuData, custData, settingsData].some(d=>isValidFbData(d) || d===null);
          setServerOk(fbOk);
        }
      } catch(e){
        console.error("[loadAll]",e);
        setServerOk(false);
      }
    };
    loadAll();

    // ── Polling to keep data fresh ──
    // Polling uses same safe process functions
    unsubs.push(fbSubscribe("bills", processBills));
    unsubs.push(fbSubscribe("menu", processMenu));
    unsubs.push(fbSubscribe("customers", processCustomers));
    unsubs.push(fbSubscribe("settings", processSettings));
    // qrOrders managed entirely by polling useEffect — no SSE subscription here
    // (SSE was setting stale orders into state before poll could delete them)
    unsubs.push(fbSubscribe("expenses",data=>{
      if(!data) return;
      // Preserve Firebase keys for deletion
      const arr=Object.entries(data).map(([k,v])=>({...v,_key:k})).sort((a,b)=>(b._ts||0)-(a._ts||0));
      setExpenses(arr);
    }));
    // Ping Firebase
    const ping=async()=>{
      try{
        const r=await fetch(`${FB}/cafes/kaka-main/settings.json`,{signal:AbortSignal.timeout(4000)});
        setServerOk(r.ok);
      }catch(e){setServerOk(false);}
    };
    ping();
    pingTimer=setInterval(ping,30000);
    return ()=>{unsubs.forEach(fn=>fn());clearInterval(pingTimer);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // QR popup detection moved to polling useEffect below


  // ── QR order polling — checks every 3s for new orders ──
  useEffect(()=>{
    const check = async () => {
      try {
        const r = await fetch(`${FB}/cafes/kaka-main/qrOrders.json`);
        if(!r.ok) return;
        const data = await r.json();
        if(!data){ setQrOrders([]); return; }
        const entries = Object.entries(data).sort((a,b)=>(a[1]._ts||0)-(b[1]._ts||0));

        if(!seenOrdersInitialized.current){
          // First run: mark every existing order as seen WITHOUT showing them
          // Do NOT set qrOrders state yet — prevents badge flash
          entries.forEach(([k])=> seenOrderKeys.current.add(k));
          seenOrdersInitialized.current = true;
          setQrOrders([]); // badge shows 0
          return;
        }

        // Filter out already-seen keys before setting state — badge never shows old orders
        const freshEntries = entries.filter(([k])=> !seenOrderKeys.current.has(k));
        setQrOrders(freshEntries.map(([k,v])=>({...v,_key:k})));

        for(const [k,v] of freshEntries){
          if(!v.items?.length){ seenOrderKeys.current.add(k); continue; }
          seenOrderKeys.current.add(k);
          if(staffUnlockedRef.current){ setIncomingOrder({...v,_key:k}); try{playBeep();}catch(e){} }
          else { pendingOrderRef.current={...v,_key:k}; }
          break;
        }
      } catch(e){}
    };
    check();
    const t = setInterval(check, 3000);
    return ()=>clearInterval(t);
  },[]); // runs once — uses refs for fresh values, not stale closures

  // ── Helpers ───────────────────────────────────────────────────────────────
  const selTbl=(t)=>{
    // Save current table's packaging/GST before switching
    if(selTable) tableSettings.current[selTable]={packaging, applyGST};
    setSelTable(t.id);
    // Load this table's cart — reset billing state for new table
    setCart(t.status==="occupied"&&t.order?.length ? t.order.map(i=>({...i})) : []);
    setBillCustName("");
    setBillCustPhone("");
    // Restore this table's packaging/GST (or reset to defaults)
    const saved = tableSettings.current[t.id];
    setPackaging(saved?.packaging ?? 0);
    setApplyGST(saved?.applyGST ?? false);
    setShowMix(false);
    setMixPay({cash:"",upi:""});
  };

  const addToCart=(item)=>{
    setCart(c=>{
      const ex=c.find(x=>x.id===item.id);
      if(ex) return c.map(x=>x.id===item.id?{...x,qty:x.qty+1}:x);
      return [...c,{...item,qty:1}];
    });
  };

  const saveOrder=async()=>{
    if(!cart.length){notify("Cart is empty","danger");return;}
    if(selTable===EDIT_TABLE_ID){notify("Cart saved locally (Edit mode — no table assigned)");return;}
    const t={...tables.find(x=>x.id===selTable),status:"occupied",order:cart};
    setTables(prev=>prev.map(x=>x.id===selTable?t:x));
    await fbSet(`tables/${selTable}`,{id:selTable,status:"occupied",order:cart});
    notify("Order saved for Table "+selTable);
  };

  const generateBill=async(mode)=>{
    if(!cart.length){notify("Cart is empty","danger");return;}
    const sub=cart.reduce((s,i)=>s+i.price*i.qty,0);
    const gst=applyGST?Math.round(sub*0.05):0;
    const total=sub+gst+packaging;
    const bn=`KC-${billN}`;
    const now=nowStr();
    const [date,time]=now.includes(", ")?now.split(", "):[todayStr(),now];
    const bill={
      id:Date.now(),billNo:bn,table:selTable,
      items:cart.map(i=>({name:i.name,price:i.price,qty:i.qty})),
      subtotal:sub,gst,packaging,total,
      paymentMode:mode,
      cashAmt:mode==="Mix"?Number(mixPay.cash)||0:0,
      upiAmt:mode==="Mix"?Number(mixPay.upi)||0:0,
      custName:billCustName,custPhone:billCustPhone,
      time,date,
      paymentStatus:"paid", // "paid" | "unpaid" — can be changed in Bills tab
    };
    setBills(prev=>[bill,...prev]);
    setBillN(n=>n+1);
    // Store Firebase push key on bill so we can delete it later
    const billFbKey = await fbPush("bills",bill);
    if(billFbKey) {
      bill._fbKey = billFbKey;
      setBills(prev=>{
        const updated=prev.map(b=>b.id===bill.id?{...b,_fbKey:billFbKey}:b);
        // Keep localStorage cache in sync
        try { localStorage.setItem("kaka_bills_cache", JSON.stringify(updated)); } catch(e) {}
        return updated;
      });
    }
    // ── Auto-save bill to localStorage CSV (silent, no clicks needed) ──
    try{
      const esc=v=>'"'+String(v||"").replace(/"/g,'""')+'"';
      const row=[bill.billNo,bill.date,bill.time,bill.table,bill.custName||"",bill.custPhone||"",
        bill.items.map(i=>i.name+"x"+i.qty).join("|"),bill.subtotal,bill.gst||0,bill.packaging||0,bill.total,bill.paymentMode,bill.cashAmt||0,bill.upiAmt||0
      ].map(esc).join(",");
      const header="Bill No,Date,Time,Table,Customer,Phone,Items,Subtotal,GST,Packaging,Total,Payment,Cash,UPI";
      // Save to today's date key
      const dayKey="kaka_bills_"+bill.date.replace(/\//g,"-");
      const dayExisting=localStorage.getItem(dayKey);
      localStorage.setItem(dayKey, dayExisting ? dayExisting+"\n"+row : header+"\n"+row);
      // Save to all-time key
      const allExisting=localStorage.getItem("kaka_bills_all");
      localStorage.setItem("kaka_bills_all", allExisting ? allExisting+"\n"+row : header+"\n"+row);
    }catch(e){}
    // Save customer
    if(billCustPhone&&billCustPhone.length>=10){
      const key="c"+billCustPhone;
      const existing=customers.find(c=>c.phone===billCustPhone);
      const custData={
        name:billCustName||existing?.name||"",
        phone:billCustPhone,
        visits:(existing?.visits||0)+1,
        firstVisit:existing?.firstVisit||date,
        lastVisit:date,
        lastTable:selTable,
        note:existing?.note||"",
      };
      fbSet(`customers/${key}`,custData); // SSE subscriber handles sync
    }
    // Free the table — await so we know the write completed before SSE can echo back
    if(selTable!==EDIT_TABLE_ID){
      const cleared={id:selTable,status:"free",order:[]};
      markTableFreed(selTable); // ignore any "occupied" Firebase echo for 6s
      setTables(prev=>prev.map(t=>t.id===selTable?cleared:t)); // immediate local update
      await fbSet(`tables/${selTable}`,cleared); // wait for write to complete
    }
    // Auto-deduct inventory based on recipes
    setIngs(prev=>{
      const updated=[...prev.map(ing=>({...ing}))];
      bill.items.forEach(item=>{
        const menuItem=menu.find(m=>m.name===item.name);
        if(!menuItem?.recipe) return;
        menuItem.recipe.forEach(r=>{
          const ing=updated.find(i=>i.id===r.i||i.id===String(r.i));
          if(ing) ing.stock=Math.max(0, (ing.stock||0) - r.q*item.qty);
        });
      });
      return updated;
    });
    // Reset cart
    setCart([]);setBillCustName("");setBillCustPhone("");setPackaging(0);setApplyGST(false);setShowMix(false);setMixPay({cash:"",upi:""});
    setPrintBill(bill);
    notify("Bill "+bn+" generated!"); addLog("BILL_GENERATED", bn+" T"+selTable+" "+fmt(total)+" "+mode);
    // WhatsApp button is in the print modal — no popup needed
  };

  const acceptIncoming=(order)=>{
    if(!order) return;
    // Always merge with current table order — read fresh from tables state
    setTables(prev=>{
      const tbl=prev.find(t=>t.id===order.tableId);
      const existingOrder=tbl?.order||[];
      const mergedOrder=[...existingOrder];
      order.items.forEach(item=>{
        const ex=mergedOrder.find(x=>x.id===item.id);
        if(ex) ex.qty+=item.qty;
        else mergedOrder.push({...item});
      });
      const updatedTable={id:order.tableId,status:"occupied",order:mergedOrder};
      // Also update cart if this table is selected
      if(selTable===order.tableId){
        setCart(mergedOrder.map(i=>({...i})));
      }
      // Write to Firebase after computing merge
      fbSet(`tables/${order.tableId}`,updatedTable);
      return prev.map(t=>t.id===order.tableId?updatedTable:t);
    });
    if(!billCustName&&order.custName) setBillCustName(order.custName);
    if(!billCustPhone&&order.custPhone) setBillCustPhone(order.custPhone);
    if(order._key){
      seenOrderKeys.current.add(order._key); // prevent poll from re-showing this order
      fbDel(`qrOrders/${order._key}`);
    }
    setQrOrders(prev=>prev.filter(o=>o._key!==order._key));
    setIncomingOrder(null);
    // Switch to billing tab and select the table
    setSelTable(order.tableId);
    setTab("billing");
    notify("✅ Order from "+(order.custName||"Guest")+" added to Table "+order.tableId);
  };

  const rejectIncoming=(order)=>{
    if(!order) return;
    if(order._key){
      seenOrderKeys.current.add(order._key); // prevent poll from re-showing this order
      fbDel(`qrOrders/${order._key}`);
    }
    setQrOrders(prev=>prev.filter(o=>o._key!==order._key));
    setIncomingOrder(null);
  };

  // ── Bill WhatsApp message ─────────────────────────────────────────────────
  const buildWhatsAppMsg=(bill)=>{
    const sep="━━━━━━━━━━━━━━━━━━━━";
    const isCash=bill.paymentMode==="Cash";
    const isUPI=bill.paymentMode==="UPI"||(bill.paymentMode==="Mix"&&(bill.upiAmt||0)>0);
    const itemLines=bill.items.map(i=>"  • "+i.name+" — "+fmt(i.price*i.qty)).join("\n");
    const gstLine=bill.gst?"\nGST (5%): "+fmt(bill.gst):"";
    const packLine=bill.packaging?"\nPackaging: "+fmt(bill.packaging):"";
    const payStr=bill.paymentMode==="Mix"?"Mix (Cash "+fmt(bill.cashAmt||0)+" + UPI "+fmt(bill.upiAmt||0)+")":bill.paymentMode;
    // UPI payment link only for UPI/Mix — never show for Cash
    const upiLine=(!isCash&&info.upiId&&isUPI)?"\n💳 Pay via UPI: "+info.upiId+"\nupi://pay?pa="+info.upiId+"&am="+(bill.upiAmt||bill.total)+"&cu=INR":"";
    const reviewLine=info.googleReview?"\n⭐ Loved your visit? Leave us a review:\n"+info.googleReview:"";
    const custLine=bill.custName?"\nCustomer: "+bill.custName:"";
    return "🧾 Bill from "+info.name+"\n"+
      info.tagline+"\n"+
      sep+"\n"+
      "Bill No: "+bill.billNo+" | Table: "+bill.table+"\n"+
      "Date: "+bill.date+" | "+bill.time+
      custLine+"\n"+
      sep+"\n"+
      itemLines+"\n"+
      sep+"\n"+
      "Subtotal: "+fmt(bill.subtotal)+gstLine+packLine+"\n"+
      "TOTAL: "+fmt(bill.total)+"\n"+
      "Payment: "+payStr+
      upiLine+"\n"+
      sep+"\n"+
      "Thank you for dining with us!\n"+
      "📍 "+info.address+"\n"+
      "📸 Instagram: "+info.email+
      reviewLine;
  };

  // ── Reports helpers ───────────────────────────────────────────────────────
  const toISO=(dateStr)=>{
    if(!dateStr) return "";
    if(dateStr.includes("-")&&dateStr.length===10) return dateStr;
    const parts=dateStr.split("/");
    if(parts.length===3) return `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
    return dateStr;
  };
  const todayISO=new Date().toISOString().slice(0,10);
  const yesterdayISO=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const fBills=bills.filter(b=>{
    const d=toISO(b.date);
    if(rRange==="today") return d===todayISO;
    if(rRange==="yesterday") return d===yesterdayISO;
    if(rRange==="week"){const w=new Date(Date.now()-7*86400000).toISOString().slice(0,10);return d>=w&&d<=todayISO;}
    if(rRange==="month"){const m=new Date(Date.now()-30*86400000).toISOString().slice(0,10);return d>=m&&d<=todayISO;}
    if(rRange==="custom") return d>=customFrom&&d<=customTo;
    return true;
  });
  const rTotals={total:fBills.reduce((s,b)=>s+b.total,0),cash:fBills.filter(b=>b.paymentMode==="Cash").reduce((s,b)=>s+b.total,0)+fBills.filter(b=>b.paymentMode==="Mix").reduce((s,b)=>s+(b.cashAmt||0),0),upi:fBills.filter(b=>b.paymentMode==="UPI").reduce((s,b)=>s+b.total,0)+fBills.filter(b=>b.paymentMode==="Mix").reduce((s,b)=>s+(b.upiAmt||0),0)};

  const occ=tables.filter(t=>t.status==="occupied").length;
  const sub=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const gstAmt=applyGST?Math.round(sub*0.05):0;
  const grandTotal=sub+gstAmt+packaging;

  const TABS=[
    {id:"billing",l:"🧾 Billing"},
    {id:"tables",l:"🪑 Tables"},
    {id:"menu",l:"📋 Menu"},
    {id:"inventory",l:"📦 Inventory"},
    {id:"bills",l:`🗒 Bills${bills.filter(b=>b.paymentStatus==="unpaid").length>0?" 🔴"+bills.filter(b=>b.paymentStatus==="unpaid").length:""}`},
    {id:"reports",l:"📊 Reports"},
    {id:"expenses",l:"💸 Expenses"},
    {id:"qr",l:`📱 QR${qrOrders.length?` 🔴${qrOrders.length}`:""}` },
    {id:"customers",l:`👥 Customers${customers.length?` (${customers.length})`:""}`},
    {id:"log",l:"📋 Log"},
    {id:"contacts",l:"📇 Contacts"},
  ];

    // ── Render ────────────────────────────────────────────────────────────────
  // Nothing shown before PIN — full lock
  if(!staffUnlocked) return <StaffGate onUnlock={()=>{
    sessionStorage.setItem("kaka_unlocked","1");
    staffUnlockedRef.current=true;
    setStaffUnlocked(true);
    // Show any order that arrived while PIN screen was up
    if(pendingOrderRef.current){
      setIncomingOrder(pendingOrderRef.current);
      pendingOrderRef.current=null;
      try{ playBeep(); }catch(e){}
    }
  }}/>;



  return (
    <div style={{minHeight:"100vh",background:C.bg,paddingBottom:40}}>

      {/* ── Header ── */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 20px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:200,height:52}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>☕</span>
          <div>
            <div style={{fontFamily:"Playfair Display",fontSize:19,color:C.accent,lineHeight:1}}>Kaka Cafe</div>
            <div style={{fontSize:10,color:C.muted}}>9:30 AM – 11:30 PM</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {qrOrders.length>0 && <div className="blink" style={{background:C.danger,color:"#fff",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}} onClick={()=>setTab("qr")}>🔔 {qrOrders.length} order{qrOrders.length>1?"s":""}</div>}
          <span style={{fontSize:12,color:occ>0?C.danger:C.muted}}>{occ>0?`🔴 ${occ} busy`:"🟢 Free"}</span>
          <span onClick={async()=>{
            // Click server indicator to run diagnostic
            try {
              const r = await fetch(`${FB_BASE}.json?shallow=true`,{cache:"no-store"});
              const d = await r.json();
              setDiagData({status:r.status, keys:d?Object.keys(d):[], raw:JSON.stringify(d).slice(0,300)});
            } catch(e){ setDiagData({error:e.message}); }
          }} style={{fontSize:11,display:"flex",alignItems:"center",gap:4,color:serverOk===true?C.success:serverOk===false?C.danger:C.muted,cursor:"pointer",userSelect:"none"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:serverOk===true?C.success:serverOk===false?C.danger:"#ccc",display:"inline-block"}}/>
            {serverOk===true?"Online":serverOk===false?"Offline":"..."}
          </span>
          {isAdmin && <span onClick={()=>{setIsAdmin(false);}} style={{fontSize:11,fontWeight:700,color:C.warn,border:`1px solid ${C.warn}44`,borderRadius:20,padding:"3px 10px",cursor:"pointer",background:C.warn+"10"}}>🔐 Admin ✕</span>}
          <Btn v="dark" size="sm" onClick={()=>setModal("settings")}>⚙</Btn>
        </div>
      </div>

      {/* ── Firebase Permission Denied Banner ── */}
      {firebaseBlocked && (
        <div style={{background:"#c0392b",color:"#fff",padding:"10px 20px",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <span>🔒 Firebase rules are locked — your data is safe but not loading.</span>
          <span style={{fontWeight:400}}>Fix: Firebase Console → Realtime Database → Rules → set .read and .write to true → Publish</span>
          <button onClick={()=>window.open("https://console.firebase.google.com","_blank")}
            style={{background:"#fff",color:"#c0392b",border:"none",borderRadius:6,padding:"4px 12px",fontWeight:700,cursor:"pointer",fontSize:12,marginLeft:"auto"}}>
            Open Firebase Console →
          </button>
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div className="tab-bar" style={{display:"flex",padding:"0 4px",background:C.surface,borderBottom:`1px solid ${C.border}`,overflowX:"auto",gap:0,position:"sticky",top:52,zIndex:199}}>
        {TABS.map(t=>{
          const locked=(t.id==="reports"||t.id==="customers")&&!isAdmin;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:"11px 14px",border:"none",borderRadius:0,background:"transparent",fontWeight:600,fontSize:13,cursor:"pointer",whiteSpace:"nowrap",color:tab===t.id?C.accent:C.muted,borderBottom:`2px solid ${tab===t.id?C.accent:"transparent"}`,transition:"all .15s"}}>
              {t.l}{locked&&<span style={{fontSize:9,marginLeft:3}}>🔒</span>}
            </button>
          );
        })}
      </div>

      <div style={{padding:"16px 20px 0"}}>

      {/* ════ BILLING ════ */}
      {tab==="billing" && (
        <div className="fade-up billing-layout">
          {/* Left: menu (full page on mobile, left panel on desktop) */}
          <div className="billing-menu">
            <Card style={{marginBottom:10,padding:12}}>
              <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:.8,marginBottom:6,textTransform:"uppercase"}}>Select Table</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {selTable===EDIT_TABLE_ID && (
                  <div style={{fontSize:11,color:C.warn,padding:"4px 10px",background:C.warn+"15",borderRadius:8,border:`1px solid ${C.warn}44`,marginBottom:4,width:"100%"}}>
                    🖊 Edit mode — select a real table to assign, or generate bill as-is
                  </div>
                )}
                {tables.map(t=>{
                  const isSel=selTable===t.id,isOcc=t.status==="occupied",hasPending=qrOrders.some(o=>o.tableId===t.id);
                  return <button key={t.id} onClick={()=>selTbl(t)}
                    style={{padding:"5px 12px",borderRadius:8,fontSize:13,fontWeight:700,
                      border:`1.5px solid ${isSel?C.accent:hasPending?C.warn:isOcc?C.danger+"88":C.border}`,
                      background:isSel?C.accent+"22":hasPending?C.warn+"11":isOcc?C.danger+"11":"transparent",
                      color:isSel?C.accent:hasPending?C.warn:isOcc?C.danger:C.muted,cursor:"pointer"}}>
                    T{t.id}{isOcc?"●":hasPending?"!":""}
                  </button>;
                })}
              </div>
              {selTable && <div style={{marginTop:6,fontSize:12,color:C.accent,fontWeight:600}}>✔ Table {selTable}</div>}
            </Card>
            {/* ── Quick-add bar — always visible above menu ── */}
            <div style={{background:C.surface,borderRadius:10,padding:"10px 12px",marginBottom:10,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:8,letterSpacing:1}}>⚡ Quick Add</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                <button onClick={()=>addToCart({id:"water-500",name:"Water Bottle 500ml",price:10,qty:1,cat:"Quick Bites",recipe:[]})}
                  style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.card,fontSize:12,cursor:"pointer",fontWeight:600}}>💧 Water 500ml ₹10</button>
                <button onClick={()=>addToCart({id:"water-1l",name:"Water Bottle 1L",price:20,qty:1,cat:"Quick Bites",recipe:[]})}
                  style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.card,fontSize:12,cursor:"pointer",fontWeight:600}}>💧 Water 1L ₹20</button>
              </div>
              <div style={{display:"flex",gap:6}}>
                <input placeholder="Custom item name" value={quickItem.name} onChange={e=>setQuickItem(q=>({...q,name:e.target.value}))} style={{fontSize:12,padding:"6px 10px",flex:1,borderRadius:8,border:`1px solid ${C.border}`,background:C.card}}/>
                <input placeholder="₹" type="number" value={quickItem.price} onChange={e=>setQuickItem(q=>({...q,price:e.target.value}))} style={{fontSize:12,padding:"6px 8px",width:60,borderRadius:8,border:`1px solid ${C.border}`,background:C.card}}/>
                <Btn size="sm" onClick={()=>{if(!quickItem.name||!quickItem.price)return;addToCart({id:"c"+Date.now(),name:quickItem.name,price:Number(quickItem.price),qty:1,cat:"Custom",recipe:[]});setQuickItem({name:"",price:""});}}>➕</Btn>
              </div>
            </div>

            {/* Sticky category bar + search */}
            <div style={{position:"sticky",top:108,zIndex:100,background:C.bg,paddingBottom:8,paddingTop:4}}>
              <div ref={scrollRef} style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:6}}>
                {CATS.map(c=>(
                  <button key={c} onClick={()=>{setActiveCat(c);catRefs.current[c]?.scrollIntoView({behavior:"smooth",block:"start"});}}
                    style={{padding:"5px 14px",borderRadius:20,border:`1.5px solid ${activeCat===c?C.accent:"transparent"}`,
                      background:activeCat===c?C.accent:C.surface,
                      color:activeCat===c?"#fff":C.muted,
                      fontWeight:600,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,
                      boxShadow:activeCat===c?"0 2px 8px "+C.accent+"44":"none",transition:"all .15s"}}>
                    {c}
                  </button>
                ))}
              </div>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search menu..." style={{marginBottom:0}}/>
            </div>
            {/* Menu grid */}
            {cats.filter(c=>!search||(menu.filter(i=>i.cat===c&&i.name.toLowerCase().includes(search.toLowerCase())).length>0)).map(c=>{
              const items=menu.filter(i=>i.cat===c&&(!search||i.name.toLowerCase().includes(search.toLowerCase())));
              if(!items.length) return null;
              return (
                <div key={c} ref={el=>catRefs.current[c]=el} style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{c}</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:8}}>
                    {items.map(item=><MCard key={item.id} item={item} cart={cart} onAdd={addToCart}/>)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: cart — desktop sticky panel */}
          <div className="billing-cart">
            <Card>
              <div style={{fontFamily:"Playfair Display",fontSize:16,marginBottom:12}}>
                {selTable===EDIT_TABLE_ID
                  ? <span>🖊 Editing Bill <span style={{fontSize:12,color:C.warn,fontFamily:"DM Sans"}}>(virtual — no table affected)</span></span>
                  : `Cart · T${selTable}`}
              </div>
              {/* Customer fields — exact 10-digit match fills name */}
              {(()=>{
                const matchedCust=billCustPhone.length===10?customers.find(c=>c.phone===billCustPhone):null;
                // Partial suggestions: show matching customers as you type (tap to fill all 10 digits)
                const partialMatches=billCustPhone.length>=4&&billCustPhone.length<10
                  ?customers.filter(c=>c.phone.startsWith(billCustPhone)).slice(0,4):[];
                return (
                  <div style={{marginBottom:10}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:4}}>
                      <input placeholder="Customer name" value={billCustName} onChange={e=>setBillCustName(e.target.value)} style={{fontSize:12,padding:"7px 10px"}}/>
                      <input placeholder="Phone" type="tel" maxLength={10} value={billCustPhone}
                        onChange={e=>{
                          const v=e.target.value.replace(/\D/g,"").slice(0,10);
                          setBillCustPhone(v);
                          if(v.length===10){
                            // Exact match — fill name
                            const found=customers.find(c=>c.phone===v);
                            if(found) setBillCustName(found.name);
                          } else {
                            // User is editing — if name was auto-filled from the old full match, clear it
                            const oldMatch=customers.find(c=>c.phone===billCustPhone);
                            if(oldMatch&&billCustName===oldMatch.name) setBillCustName("");
                          }
                        }} style={{fontSize:12,padding:"7px 10px"}}/>
                    </div>
                    {/* Partial suggestions — just suggestions, tap to pick */}
                    {partialMatches.length>0 && (
                      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden",marginBottom:4}}>
                        {partialMatches.map(c=>(
                          <div key={c.phone} onClick={()=>{setBillCustPhone(c.phone);setBillCustName(c.name);}}
                            style={{padding:"6px 10px",cursor:"pointer",borderBottom:`1px solid ${C.border}22`,fontSize:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}
                            onMouseEnter={e=>e.currentTarget.style.background=C.card}
                            onMouseLeave={e=>e.currentTarget.style.background=""}>
                            <span style={{fontWeight:600}}>{c.name}</span>
                            <span style={{color:C.muted,fontSize:11}}>{c.phone} · {c.visits} visits</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Exact match badge */}
                    {matchedCust && (
                      <div style={{background:C.success+"15",border:`1px solid ${C.success}44`,borderRadius:8,padding:"5px 10px",fontSize:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{color:C.success,fontWeight:700}}>✓ Returning — {matchedCust.name}</span>
                        <span style={{color:C.muted}}>{matchedCust.visits} visit{matchedCust.visits!==1?"s":""}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
              {cart.length===0 ? (
                <div style={{textAlign:"center",padding:"24px 0",color:C.muted,fontSize:13}}>No items added</div>
              ) : (
                <>
                  {cart.map(item=>(
                    <div key={item.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${C.border}22`}}>
                      <div style={{fontSize:12,flex:1,lineHeight:1.3}}>{item.name}</div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <button onClick={()=>setCart(c=>{const ex=c.find(x=>x.id===item.id);if(!ex)return c;if(ex.qty===1)return c.filter(x=>x.id!==item.id);return c.map(x=>x.id===item.id?{...x,qty:x.qty-1}:x);})}
                          style={{width:22,height:22,borderRadius:"50%",border:`1px solid ${C.border}`,background:C.surface,cursor:"pointer",fontWeight:800}}>−</button>
                        <span style={{fontSize:13,fontWeight:700,minWidth:16,textAlign:"center"}}>{item.qty}</span>
                        <button onClick={()=>addToCart(item)}
                          style={{width:22,height:22,borderRadius:"50%",border:"none",background:C.accent,color:"#fff",cursor:"pointer",fontWeight:800}}>+</button>
                        <span style={{fontSize:12,fontWeight:700,color:C.accent,minWidth:44,textAlign:"right"}}>{fmt(item.price*item.qty)}</span>
                      </div>
                    </div>
                  ))}
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.muted,marginBottom:4}}>
                      <span>Subtotal</span><span>{fmt(sub)}</span>
                    </div>
                    {/* GST toggle */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <label style={{fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                        <input type="checkbox" checked={applyGST} onChange={e=>setApplyGST(e.target.checked)} style={{width:"auto"}}/>
                        GST (5%)
                      </label>
                      {applyGST && <span style={{fontSize:12,color:C.muted}}>{fmt(gstAmt)}</span>}
                    </div>
                    {/* Packaging */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <label style={{fontSize:12,display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                        <input type="checkbox" checked={packaging>0} onChange={e=>setPackaging(e.target.checked?20:0)} style={{width:"auto"}}/>
                        Packaging
                      </label>
                      {packaging>0 && (
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <button onClick={()=>setPackaging(p=>Math.max(0,p-10))}
                            style={{width:26,height:26,borderRadius:6,border:`1px solid ${C.border}`,background:C.surface,fontWeight:800,cursor:"pointer",fontSize:15,lineHeight:1}}>−</button>
                          <span style={{fontSize:13,fontWeight:700,minWidth:34,textAlign:"center",color:C.accent}}>{fmt(packaging)}</span>
                          <button onClick={()=>setPackaging(p=>p+10)}
                            style={{width:26,height:26,borderRadius:6,border:"none",background:C.accent,color:"#fff",fontWeight:800,cursor:"pointer",fontSize:15,lineHeight:1}}>+</button>
                        </div>
                      )}
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontWeight:800,fontSize:15,marginBottom:10}}>
                      <span>Total</span><span style={{color:C.accent}}>{fmt(grandTotal)}</span>
                    </div>
                    {/* Quick add items */}
                    <div style={{display:"flex",gap:6,marginBottom:10}}>
                      {menu.filter(i=>i.name.includes("Water")||i.name.includes("water")).slice(0,2).map(item=>(
                        <button key={item.id} onClick={()=>addToCart(item)}
                          style={{flex:1,padding:"5px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,fontSize:11,cursor:"pointer"}}>
                          +{item.name}
                        </button>
                      ))}
                    </div>
                    {/* Water bottle quick-add */}
                    <div style={{display:"flex",gap:6,marginBottom:8}}>
                      <button onClick={()=>addToCart({id:"water-500",name:"Water Bottle 500ml",price:10,qty:1,cat:"Quick Bites",recipe:[]})} style={{flex:1,padding:"6px 4px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,fontSize:11,cursor:"pointer",fontWeight:600}}>💧 500ml ₹10</button>
                      <button onClick={()=>addToCart({id:"water-1l",name:"Water Bottle 1L",price:20,qty:1,cat:"Quick Bites",recipe:[]})} style={{flex:1,padding:"6px 4px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,fontSize:11,cursor:"pointer",fontWeight:600}}>💧 1L ₹20</button>
                    </div>
                    {/* Custom item */}
                    <div style={{display:"flex",gap:6,marginBottom:10}}>
                      <input placeholder="Custom item" value={quickItem.name} onChange={e=>setQuickItem(q=>({...q,name:e.target.value}))} style={{fontSize:12,padding:"6px 8px",flex:1}}/>
                      <input placeholder="₹" type="number" value={quickItem.price} onChange={e=>setQuickItem(q=>({...q,price:e.target.value}))} style={{fontSize:12,padding:"6px 8px",width:60}}/>
                      <Btn size="sm" onClick={()=>{if(!quickItem.name||!quickItem.price)return;addToCart({id:"c"+Date.now(),name:quickItem.name,price:Number(quickItem.price),qty:1,cat:"Custom",recipe:[]});setQuickItem({name:"",price:""});}}>Add</Btn>
                    </div>
                    {cart.length>0 && (
                      <Btn full v="dark" size="sm" style={{marginBottom:6}} onClick={()=>{
                        // Kitchen order: items + qty + table only, no prices
                        const lines=cart.map(i=>i.name+" x"+i.qty).join("\n");
                        const msg="*KOT - Table "+selTable+"*\n"+lines+"\n\n_"+nowStr()+"_";
                        // Opens WhatsApp — user picks kitchen group (can't auto-select group)
                        const url="https://wa.me/?text="+encodeURIComponent(msg);
                        window.open(url,"_blank");
                      }}>📢 Send KOT to Kitchen</Btn>
                    )}
                    <div style={{display:"flex",gap:6,marginBottom:8}}>
                      <Btn full v="muted" size="sm" onClick={saveOrder}>💾 Save Order</Btn>
                      <Btn v="danger" size="sm" onClick={()=>{if(!cart.length)return;if(window.confirm("Clear all items from cart?")){
              setCart([]);setBillCustName("");setBillCustPhone("");setPackaging(0);setApplyGST(false);setShowMix(false);setMixPay({cash:"",upi:""});
              if(selTable){
                const cleared={id:selTable,status:"free",order:[]};
                markTableFreed(selTable);
                setTables(prev=>prev.map(t=>t.id===selTable?cleared:t));
                fbSet(`tables/${selTable}`,cleared);
              }
            }}}>🗑</Btn>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                      <Btn full v="success" onClick={()=>generateBill("Cash")}>💵 Cash</Btn>
                      <Btn full v="primary" onClick={()=>generateBill("UPI")}>📱 UPI</Btn>
                    </div>
                    <div style={{marginTop:6}}>
                      {!showMix ? (
                        <Btn full v="ghost" size="sm" onClick={()=>setShowMix(true)}>+ Mix Payment</Btn>
                      ) : (
                        <div>
                          <div style={{display:"flex",gap:6,marginBottom:6}}>
                            <input placeholder="Cash ₹" type="number" value={mixPay.cash} onChange={e=>{const c=Number(e.target.value);setMixPay({cash:e.target.value,upi:String(Math.max(0,grandTotal-c))});}} style={{fontSize:12,padding:"6px 8px"}}/>
                            <input placeholder="UPI ₹" type="number" value={mixPay.upi} onChange={e=>setMixPay(m=>({...m,upi:e.target.value}))} style={{fontSize:12,padding:"6px 8px"}}/>
                          </div>
                          <Btn full v="warn" onClick={()=>generateBill("Mix")}>💳 Collect Mix</Btn>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>
          {/* Mobile cart drawer — same cart, shown as slide-up panel */}
        <div className={`billing-cart-drawer ${cartDrawerOpen?"open":"closed"}`}>
          <div className="drawer-handle" onClick={()=>setCartDrawerOpen(o=>!o)}>
            <div style={{fontWeight:700,fontSize:14,color:"#b85c00"}}>
              🛒 Cart · T{selTable||"—"} {cart.length>0&&<span style={{background:"#b85c00",color:"#fff",borderRadius:20,padding:"1px 8px",fontSize:11,marginLeft:6}}>{cart.reduce((s,i)=>s+i.qty,0)} items · ₹{cart.reduce((s,i)=>s+i.price*i.qty,0)}</span>}
            </div>
            <div style={{fontSize:18,color:"#b85c00"}}>{cartDrawerOpen?"▼":"▲"}</div>
          </div>
          <div className="drawer-body">
            <div style={{fontFamily:"Playfair Display",fontSize:15,marginBottom:10,color:"#b85c00"}}>
              {selTable===EDIT_TABLE_ID ? "🖊 Edit Mode" : `Cart · T${selTable}`}
            </div>
            {cart.length===0 ? (
              <div style={{textAlign:"center",padding:"16px 0",color:"#7a6a50",fontSize:13}}>No items — add from menu above</div>
            ) : (
              <>
                {cart.map(item=>(
                  <div key={item.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #d6ccb844"}}>
                    <div style={{fontSize:12,flex:1}}>{item.name}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <button onClick={()=>setCart(c=>{const ex=c.find(x=>x.id===item.id);if(!ex)return c;if(ex.qty===1)return c.filter(x=>x.id!==item.id);return c.map(x=>x.id===item.id?{...x,qty:x.qty-1}:x);})}
                        style={{width:22,height:22,borderRadius:"50%",border:"1px solid #d6ccb8",background:"#ede7d9",cursor:"pointer",fontWeight:800}}>−</button>
                      <span style={{fontSize:13,fontWeight:700,minWidth:16,textAlign:"center"}}>{item.qty}</span>
                      <button onClick={()=>addToCart(item)}
                        style={{width:22,height:22,borderRadius:"50%",border:"none",background:"#b85c00",color:"#fff",cursor:"pointer",fontWeight:800}}>+</button>
                      <span style={{fontSize:12,fontWeight:700,color:"#b85c00",minWidth:44,textAlign:"right"}}>{fmt(item.price*item.qty)}</span>
                    </div>
                  </div>
                ))}
                <div style={{marginBottom:6}}>
                  <label style={{fontSize:12,display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                    <input type="checkbox" checked={applyGST} onChange={e=>setApplyGST(e.target.checked)} style={{width:"auto"}}/>
                    GST (5%) {applyGST && <span style={{color:"#b85c00"}}>+{fmt(gstAmt)}</span>}
                  </label>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
                    <input type="checkbox" checked={packaging>0} onChange={e=>setPackaging(e.target.checked?20:0)} style={{width:"auto",cursor:"pointer"}}/>
                    <span style={{fontSize:12,cursor:"pointer"}} onClick={()=>setPackaging(p=>p>0?0:20)}>Packaging</span>
                    {packaging>0 && (
                      <div style={{display:"flex",alignItems:"center",gap:4,marginLeft:"auto"}}>
                        <button onClick={()=>setPackaging(p=>Math.max(0,p-10))}
                          style={{width:22,height:22,borderRadius:"50%",border:"1px solid #d6ccb8",background:"#ede7d9",cursor:"pointer",fontWeight:800,fontSize:13}}>−</button>
                        <span style={{fontSize:12,fontWeight:700,color:"#b85c00",minWidth:32,textAlign:"center"}}>{fmt(packaging)}</span>
                        <button onClick={()=>setPackaging(p=>p+10)}
                          style={{width:22,height:22,borderRadius:"50%",border:"none",background:"#b85c00",color:"#fff",cursor:"pointer",fontWeight:800,fontSize:13}}>+</button>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{fontWeight:800,fontSize:15,padding:"10px 0 8px",borderTop:"1px solid #d6ccb8",display:"flex",justifyContent:"space-between"}}>
                  <span>Total</span><span style={{color:"#b85c00"}}>{fmt(grandTotal)}</span>
                </div>
                <div style={{display:"flex",gap:6,marginBottom:8}}>
                  <Btn full v="muted" size="sm" onClick={saveOrder}>💾 Save</Btn>
                  <Btn v="danger" size="sm" onClick={()=>{if(!cart.length)return;if(window.confirm("Clear cart?")){setCart([]);if(selTable){const cleared={id:selTable,status:"free",order:[]};setTables(prev=>prev.map(t=>t.id===selTable?cleared:t));fbSet(`tables/${selTable}`,cleared);}}}}>🗑</Btn>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  <Btn full v="success" onClick={()=>{generateBill("Cash");setCartDrawerOpen(false);}}>💵 Cash</Btn>
                  <Btn full v="primary" onClick={()=>{generateBill("UPI");setCartDrawerOpen(false);}}>📱 UPI</Btn>
                </div>
                <div style={{marginTop:6}}>
                  <Btn full v="ghost" size="sm" onClick={()=>{generateBill("Mix");setCartDrawerOpen(false);}}>🔀 Mix Payment</Btn>
                </div>
              </>
            )}
          </div>
        </div>
        </div>
      )}

      {/* ════ ACTIVITY LOG ════ */}
      {tab==="log" && (
        <div className="fade-up">
          <div style={{fontFamily:"Playfair Display",fontSize:20,marginBottom:12}}>📋 Activity Log</div>
          <Card style={{marginBottom:12,padding:"10px 14px",background:C.info+"08"}}>
            <div style={{fontSize:12,color:C.muted}}>Last 100 actions on this device. Useful for debugging issues.</div>
          </Card>
          <Btn size="sm" v="danger" style={{marginBottom:12}} onClick={()=>{localStorage.removeItem("kaka_log");notify("Log cleared");}}>🗑 Clear Log</Btn>
          {(()=>{
            try {
              const logs=JSON.parse(localStorage.getItem("kaka_log")||"[]");
              if(!logs.length) return <Card style={{textAlign:"center",padding:40,color:C.muted}}>No activity yet</Card>;
              return (
                <Card style={{padding:0,overflow:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead><tr style={{background:C.surface}}>
                      {["Time","Action","Detail"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",color:C.muted,fontWeight:700,fontSize:11,textTransform:"uppercase"}}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {logs.map((l,i)=>(
                        <tr key={i} style={{borderBottom:`1px solid ${C.border}33`}}>
                          <td style={{padding:"7px 12px",color:C.muted,whiteSpace:"nowrap"}}>{l.t}</td>
                          <td style={{padding:"7px 12px",fontWeight:700,color:C.accent}}>{l.action}</td>
                          <td style={{padding:"7px 12px"}}>{l.detail||"—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              );
            } catch(e){ return <Card style={{color:C.danger}}>Error reading log</Card>; }
          })()}
        </div>
      )}

      {/* ════ TABLES ════ */}
      {tab==="tables" && (
        <div className="fade-up">
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:12}}>
            {tables.map(t=>(
              <Card key={t.id} style={{borderLeft:`4px solid ${t.status==="occupied"?C.danger:qrOrders.some(o=>o.tableId===t.id)?C.warn:C.success}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontFamily:"Playfair Display",fontSize:17,fontWeight:700}}>Table {t.id}</div>
                  <span style={{width:10,height:10,borderRadius:"50%",background:t.status==="occupied"?C.danger:C.success,display:"inline-block"}}/>
                </div>
                {t.status==="occupied" && t.order?.length>0 ? (
                  <>
                    <div style={{fontSize:12,color:C.muted,marginBottom:8}}>{t.order.length} item(s) · {fmt(t.order.reduce((s,i)=>s+i.price*i.qty,0))}</div>
                    <div style={{fontSize:11,color:C.muted,marginBottom:10,maxHeight:60,overflowY:"auto"}}>
                      {t.order.map(i=>`${i.name} x${i.qty}`).join(", ")}
                    </div>
                    <div style={{display:"flex",gap:6,marginTop:4}}>
                      <Btn full size="sm" onClick={()=>{selTbl(t);setTab("billing");}}>Open & Bill</Btn>
                      <button onClick={()=>setQrView(t.id)} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,cursor:"pointer",fontSize:14}} title="QR Code">📱</button>
                    </div>
                  </>
                ) : (
                  <>
                    {qrOrders.some(o=>o.tableId===t.id) && <div style={{fontSize:11,color:C.warn,marginBottom:8}}>⚡ QR order pending</div>}
                    <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Free</div>
                    <div style={{display:"flex",gap:6,marginTop:4}}>
                      <Btn full size="sm" v="ghost" onClick={()=>{selTbl(t);setTab("billing");}}>+ New Order</Btn>
                      <button onClick={()=>setQrView(t.id)} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,cursor:"pointer",fontSize:14}} title="Show QR">📱</button>
                    </div>
                  </>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ════ MENU ════ */}
      {tab==="menu" && (
        <div className="fade-up">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontFamily:"Playfair Display",fontSize:20}}>Menu Management</div>
            <Btn onClick={()=>setModal("addItem")}>+ Add Item</Btn>
          </div>
          {/* Manage Categories */}
          <Card style={{marginBottom:14,padding:12}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>📂 Categories</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
              {cats.map(c=>(
                <div key={c} style={{display:"flex",alignItems:"center",gap:4,background:C.surface,borderRadius:20,padding:"4px 10px",border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:12,fontWeight:600}}>{c}</span>
                  <button onClick={()=>{if(menu.filter(i=>i.cat===c).length>0){notify("Move items out of "+c+" before removing","danger");return;}if(window.confirm("Remove category '"+c+"'?"))saveCats(cats.filter(x=>x!==c));}}
                    style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:13,lineHeight:1,padding:"0 2px"}}>✕</button>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:6}}>
              <input placeholder="New category name" value={newCatName} onChange={e=>setNewCatName(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&newCatName.trim()){saveCats([...cats,newCatName.trim()]);setNewCatName("");}}}
                style={{fontSize:12,padding:"6px 10px",flex:1}}/>
              <Btn size="sm" onClick={()=>{if(!newCatName.trim())return;saveCats([...cats,newCatName.trim()]);setNewCatName("");}}>+ Add</Btn>
            </div>
          </Card>
          {cats.map(c=>{
            const items=menu.filter(i=>i.cat===c);
            return (
              <div key={c} style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:800,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>{c} ({items.length})</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
                  {items.map(item=>(
                    <Card key={item.id} style={{padding:10}}>
                      {editItem?.id===item.id ? (
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          <input value={editItem.name} onChange={e=>setEditItem(x=>({...x,name:e.target.value}))} style={{fontSize:12,padding:"5px 8px"}} placeholder="Name"/>
                          <input value={editItem.price} type="number" onChange={e=>setEditItem(x=>({...x,price:e.target.value}))} style={{fontSize:12,padding:"5px 8px"}} placeholder="Price"/>
                          <select value={editItem.cat} onChange={e=>setEditItem(x=>({...x,cat:e.target.value}))} style={{fontSize:12,padding:"5px 8px"}}>
                            {cats.map(cc=><option key={cc} value={cc}>{cc}</option>)}
                          </select>
                          <div style={{display:"flex",gap:4}}>
                            <Btn full size="sm" v="success" onClick={()=>{saveMenu(menu.map(x=>x.id===item.id?{...x,name:editItem.name,price:Number(editItem.price),cat:editItem.cat}:x));setEditItem(null);}}>✓ Save</Btn>
                            <Btn size="sm" v="ghost" onClick={()=>setEditItem(null)}>✕</Btn>
                          </div>
                        </div>
                      ) : (
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                          <div style={{flex:1,cursor:"pointer"}} onClick={()=>setEditItem({id:item.id,name:item.name,price:item.price,cat:item.cat})}>
                            <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{item.name}</div>
                            <div style={{fontWeight:800,color:C.accent,fontSize:14}}>{fmt(item.price)}</div>
                          </div>
                          <div style={{display:"flex",gap:4,flexShrink:0,marginLeft:8}}>
                            <Btn size="sm" v="ghost" onClick={()=>setEditItem({id:item.id,name:item.name,price:item.price,cat:item.cat})}>✏</Btn>
                            <Btn size="sm" v="ghost" onClick={()=>{setMdata(item);setModal("recipe");}}>Recipe</Btn>
                            <Btn size="sm" v="danger" onClick={()=>{saveMenu(menu.filter(x=>x.id!==item.id));fbDel(`menu/${item.id}`);}}>✕</Btn>
                          </div>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ════ INVENTORY ════ */}
      {tab==="inventory" && (
        <div className="fade-up">
          <div style={{fontFamily:"Playfair Display",fontSize:20,marginBottom:14}}>Inventory</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
            {[
              {label:"Total Items",val:ings.length,c:C.info},
              {label:"Low Stock",val:ings.filter(i=>i.stock<=i.low).length,c:C.danger},
              {label:"OK",val:ings.filter(i=>i.stock>i.low).length,c:C.success},
              {label:"Out of Stock",val:ings.filter(i=>i.stock===0).length,c:C.warn},
            ].map(({label,val,c})=>(
              <Card key={label} style={{textAlign:"center"}}>
                <div style={{fontSize:28,fontWeight:800,color:c}}>{val}</div>
                <div style={{fontSize:11,color:C.muted}}>{label}</div>
              </Card>
            ))}
          </div>
          {ings.filter(i=>i.stock<=i.low).length>0 && (
            <Card style={{marginBottom:16,background:C.danger+"08",border:`1px solid ${C.danger}33`}}>
              <div style={{fontWeight:700,color:C.danger,marginBottom:8}}>⚠ Low Stock Alert</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {ings.filter(i=>i.stock<=i.low).map(i=>(
                  <span key={i.id} style={{background:C.danger+"15",color:C.danger,border:`1px solid ${C.danger}33`,borderRadius:6,padding:"3px 10px",fontSize:12,fontWeight:600}}>{i.name}: {i.stock}{i.unit}</span>
                ))}
              </div>
            </Card>
          )}
          <Card>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
                {["Ingredient","Stock","Unit","Low Threshold","Status","Action"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {ings.map(ing=>(
                  <tr key={ing.id} style={{borderBottom:`1px solid ${C.border}33`}}>
                    <td style={{padding:"8px 10px",fontWeight:600,fontSize:13}}>{ing.name}</td>
                    <td style={{padding:"8px 10px",fontWeight:700,color:ing.stock<=ing.low?C.danger:C.success}}>{ing.stock}</td>
                    <td style={{padding:"8px 10px",color:C.muted,fontSize:12}}>{ing.unit}</td>
                    <td style={{padding:"8px 10px",color:C.muted,fontSize:12}}>{ing.low}</td>
                    <td style={{padding:"8px 10px"}}><span style={{fontSize:11,fontWeight:700,color:ing.stock===0?C.danger:ing.stock<=ing.low?C.warn:C.success}}>{ing.stock===0?"Out":ing.stock<=ing.low?"Low":"OK"}</span></td>
                    <td style={{padding:"8px 6px"}}>
                      <div style={{display:"flex",gap:4,alignItems:"center"}}>
                        <button onClick={()=>setIngs(prev=>prev.map(x=>x.id===ing.id?{...x,stock:Math.max(0,(x.stock||0)-1)}:x))}
                          style={{width:22,height:22,borderRadius:"50%",border:`1px solid ${C.border}`,background:C.surface,cursor:"pointer",fontWeight:800,fontSize:13}}>−</button>
                        <input type="number" value={ing.stock||0}
                          onChange={e=>setIngs(prev=>prev.map(x=>x.id===ing.id?{...x,stock:Math.max(0,Number(e.target.value)||0)}:x))}
                          style={{width:52,textAlign:"center",fontSize:12,padding:"3px 4px",borderRadius:6,border:`1px solid ${C.border}`}}/>
                        <button onClick={()=>setIngs(prev=>prev.map(x=>x.id===ing.id?{...x,stock:(x.stock||0)+1}:x))}
                          style={{width:22,height:22,borderRadius:"50%",border:"none",background:C.accent,color:"#fff",cursor:"pointer",fontWeight:800,fontSize:13}}>+</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ════ BILLS ════ */}
      {tab==="bills" && (()=>{
        // Filter bills
        const toISO2=d=>{if(!d)return"";const p=d.split("/");if(p.length===3)return`${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;return d;};
        const todayISO2=new Date().toISOString().slice(0,10);
        const yestISO2=new Date(Date.now()-864e5).toISOString().slice(0,10);
        let filtered=[...bills];
        if(billFilter==="today") filtered=bills.filter(b=>toISO2(b.date)===todayISO2);
        else if(billFilter==="yesterday") filtered=bills.filter(b=>toISO2(b.date)===yestISO2);
        else if(billFilter==="custom") filtered=bills.filter(b=>{const d=toISO2(b.date);return d>=billDateFrom&&d<=billDateTo;});
        else if(billFilter==="unpaid") filtered=bills.filter(b=>b.paymentStatus==="unpaid");
        // Sort
        const billNum = bn => parseInt(String(bn||"0").replace(/\D/g,""))||0;
        if(billSort==="oldest") filtered.sort((a,b)=>billNum(a.billNo)-billNum(b.billNo));
        else if(billSort==="newest") filtered.sort((a,b)=>billNum(b.billNo)-billNum(a.billNo));
        else if(billSort==="highest") filtered.sort((a,b)=>(b.total||0)-(a.total||0));
        else if(billSort==="lowest") filtered.sort((a,b)=>(a.total||0)-(b.total||0));
        return (
        <div className="fade-up">
          <div style={{fontFamily:"Playfair Display",fontSize:20,marginBottom:12}}>Bill History ({bills.length})</div>
          {/* Filters */}
          <Card style={{marginBottom:12,padding:"10px 14px"}}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              {["all","today","yesterday","custom","unpaid"].map(f=>(
                <button key={f} onClick={()=>setBillFilter(f)}
                  style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${billFilter===f?(f==="unpaid"?C.danger:C.accent):C.border}`,
                  background:billFilter===f?(f==="unpaid"?C.danger:C.accent):"transparent",
                  color:billFilter===f?"#fff":(f==="unpaid"?C.danger:C.muted),fontWeight:600,fontSize:12,cursor:"pointer"}}>
                  {f==="all"?"All":f==="today"?"Today":f==="yesterday"?"Yesterday":f==="custom"?"Custom":"🔴 Unpaid"}
                </button>
              ))}
              <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontSize:11,color:C.muted}}>Sort:</span>
                <select value={billSort} onChange={e=>setBillSort(e.target.value)}
                  style={{fontSize:12,padding:"5px 8px",borderRadius:8,border:`1px solid ${C.border}`,background:C.card}}>
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="highest">Highest Amount</option>
                  <option value="lowest">Lowest Amount</option>
                </select>
              </div>
            </div>
            {billFilter==="custom" && (
              <div style={{display:"flex",gap:8,marginTop:8,alignItems:"center"}}>
                <input type="date" value={billDateFrom} onChange={e=>setBillDateFrom(e.target.value)}
                  style={{fontSize:12,padding:"5px 8px",borderRadius:8,border:`1px solid ${C.border}`}}/>
                <span style={{fontSize:12,color:C.muted}}>to</span>
                <input type="date" value={billDateTo} onChange={e=>setBillDateTo(e.target.value)}
                  style={{fontSize:12,padding:"5px 8px",borderRadius:8,border:`1px solid ${C.border}`}}/>
              </div>
            )}
          </Card>
          <div style={{fontSize:12,color:C.muted,marginBottom:8}}>Showing {filtered.length} bill{filtered.length!==1?"s":""}</div>
          {filtered.length===0 ? (
            <Card style={{textAlign:"center",padding:40,color:C.muted}}>No bills for this period</Card>
          ) : (
            <Card style={{padding:0,overflow:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:600}}>
                <thead><tr style={{background:C.surface}}>
                  {["Bill No","Date","Table","Customer","Total","Payment",""].map(h=>(
                    <th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.map(b=>(
                    <tr key={b.id||b.billNo} style={{borderBottom:`1px solid ${C.border}33`}}>
                      <td style={{padding:"9px 12px",fontWeight:700,fontSize:13,color:C.accent,whiteSpace:"nowrap"}}>{b.billNo}</td>
                      <td style={{padding:"9px 12px",fontSize:12,color:C.muted,whiteSpace:"nowrap"}}>{b.date} {b.time}</td>
                      <td style={{padding:"9px 12px",fontSize:13}}>T{b.table}</td>
                      <td style={{padding:"9px 12px",fontSize:13}}>{b.custName||"—"}</td>
                      <td style={{padding:"9px 12px",fontWeight:700,whiteSpace:"nowrap"}}>{fmt(b.total)}</td>
                      <td style={{padding:"9px 8px"}}>
                        <div style={{display:"flex",flexDirection:"column",gap:3}}>
                          <span style={{fontSize:11,fontWeight:700,color:b.paymentMode==="Cash"?C.success:b.paymentMode==="UPI"?C.info:C.warn}}>{b.paymentMode}</span>
                          <button onClick={()=>{
                            if(!isAdmin) return;
                            const newStatus=b.paymentStatus==="unpaid"?"paid":"unpaid";
                            const updated={...b,paymentStatus:newStatus};
                            setBills(prev=>prev.map(x=>x.id===b.id?updated:x));
                            fbSet(`bills/${b._fbKey||b.id}`,updated);
                            notify(b.billNo+" marked "+newStatus);
                          }} style={{fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:8,border:"none",cursor:isAdmin?"pointer":"default",
                            background:b.paymentStatus==="unpaid"?C.danger+"22":"#e8f5e9",
                            color:b.paymentStatus==="unpaid"?C.danger:C.success}}>
                            {b.paymentStatus==="unpaid"?"🔴 Unpaid":"✅ Paid"}
                          </button>
                        </div>
                      </td>
                      <td style={{padding:"9px 12px"}}>
                        <div style={{display:"flex",gap:4,flexWrap:"nowrap"}}>
                          <Btn size="sm" v="ghost" onClick={()=>setPrintBill(b)}>🖨</Btn>
                          {b.custPhone && <Btn size="sm" v="success" onClick={()=>sendWhatsApp(b.custPhone,buildWhatsAppMsg(b))}>📲</Btn>}
                          {isAdmin && (
                              <>
                                <Btn size="sm" v="ghost" onClick={()=>{
                                  if(!window.confirm("Reopen bill "+b.billNo+" in Billing to edit? It will be deleted and recreated.")) return;
                                  // Use virtual EDIT table (id=0) — never touches real tables
                                  setSelTable(EDIT_TABLE_ID);
                                  setCart(b.items.map(i=>({...i})));
                                  setBillCustName(b.custName||"");
                                  setBillCustPhone(b.custPhone||"");
                                  setPackaging(b.packaging||0);
                                  setApplyGST((b.gst||0)>0);
                                  setBills(prev=>prev.filter(x=>x.id!==b.id));
                                  fbDel(`bills/${b._fbKey||b.id}`);
                                  setTab("billing");
                                  notify("Editing "+b.billNo+" — Table shown as EDIT, real tables unaffected");
                                }}>✏️</Btn>
                                <Btn size="sm" v="danger" onClick={()=>{
                                  if(!window.confirm(`Delete bill ${b.billNo}?`)) return;
                                  setBills(prev=>prev.filter(x=>x.id!==b.id));
                                  fbDel(`bills/${b._fbKey||b.id}`);
                                  notify("Bill deleted"); addLog("BILL_DELETED", b.billNo);
                                }}>🗑</Btn>
                              </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
        );
      })()}

      {/* ════ REPORTS (admin only) ════ */}
      {tab==="reports" && (
        !isAdmin ? (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 20px",textAlign:"center"}}>
            <div style={{fontSize:56,marginBottom:16}}>🔒</div>
            <div style={{fontFamily:"Playfair Display",fontSize:22,marginBottom:8}}>Admin Access Required</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:24}}>Reports are restricted to admin only</div>
            <Btn v="primary" onClick={()=>setAdminModal(true)}>Enter Admin Mode</Btn>
          </div>
        ) : (
          <div className="fade-up">
            <div style={{fontFamily:"Playfair Display",fontSize:20,marginBottom:14}}>Reports</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
              {["today","yesterday","week","month","custom"].map(r=>(
                <button key={r} onClick={()=>setRRange(r)}
                  style={{padding:"6px 16px",borderRadius:20,border:`1px solid ${rRange===r?C.accent:C.border}`,background:rRange===r?C.accent:"transparent",color:rRange===r?"#fff":C.muted,fontWeight:600,fontSize:12,cursor:"pointer"}}>
                  {r==="today"?"Today":r==="yesterday"?"Yesterday":r==="week"?"Last 7 Days":r==="month"?"Last 30 Days":"Custom Range"}
                </button>
              ))}
              <button onClick={()=>{
                const esc=v=>{const s=String(v??"");return(s.includes(",")||s.includes('"'))?'"'+s.replace(/"/g,'""')+'"':s;};
                const HDR="Bill No,Date,Time,Table,Customer,Phone,Items,Subtotal,GST,Packaging,Total,Payment";
                const rows=fBills.map(b=>[b.billNo,b.date,b.time,b.table,b.custName||"",b.custPhone||"",b.items.map(i=>`${i.name}x${i.qty}`).join("|"),b.subtotal,b.gst||0,b.packaging||0,b.total,b.paymentMode].map(esc).join(",")).join("\n");
                const blob=new Blob(["\uFEFF"+HDR+"\n"+rows],{type:"text/csv;charset=utf-8"});
                const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`Kaka-Report-${rRange}.csv`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
              }} style={{padding:"6px 16px",borderRadius:20,border:`1px solid ${C.success}`,background:C.success,color:"#fff",fontWeight:600,fontSize:12,cursor:"pointer"}}>📥 Export CSV</button>
            </div>
            {rRange==="custom" && (
              <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center"}}>
                <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} style={{maxWidth:160}}/>
                <span style={{color:C.muted}}>to</span>
                <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)} style={{maxWidth:160}}/>
              </div>
            )}
            {/* ── Summary Cards ── */}
            {(()=>{
              const periodExp=expenses.filter(e=>{
                const d=toISO(e.date);
                if(rRange==="today") return d===todayISO;
                if(rRange==="yesterday") return d===yesterdayISO;
                if(rRange==="week"){const w=new Date(Date.now()-7*86400000).toISOString().slice(0,10);return d>=w&&d<=todayISO;}
                if(rRange==="month"){const m=new Date(Date.now()-30*86400000).toISOString().slice(0,10);return d>=m&&d<=todayISO;}
                if(rRange==="custom") return d>=customFrom&&d<=customTo;
                return true;
              });
              const totalExp=periodExp.reduce((s,e)=>s+e.amount,0);
              const profit=rTotals.total-totalExp;
              return (
                <>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:10}}>
                    <Card style={{textAlign:"center",background:C.accent+"0d",border:`1px solid ${C.accent}33`}}>
                      <div style={{fontSize:24,fontWeight:800,color:C.accent}}>{fmt(rTotals.total)}</div>
                      <div style={{fontSize:12,fontWeight:700,color:C.accent,marginTop:2}}>Total Sales</div>
                      <div style={{fontSize:11,color:C.muted,marginTop:2}}>{fBills.length} bill{fBills.length!==1?"s":""} · Avg {fmt(Math.round(fBills.length?rTotals.total/fBills.length:0))}</div>
                    </Card>
                    <Card style={{textAlign:"center",background:C.danger+"0d",border:`1px solid ${C.danger}33`}}>
                      <div style={{fontSize:24,fontWeight:800,color:C.danger}}>{fmt(totalExp)}</div>
                      <div style={{fontSize:12,fontWeight:700,color:C.danger,marginTop:2}}>Total Expenses</div>
                      <div style={{fontSize:11,color:C.muted,marginTop:2}}>{periodExp.length} entr{periodExp.length!==1?"ies":"y"}</div>
                    </Card>
                  </div>
                  <Card style={{marginBottom:10,background:profit>=0?C.success+"0d":C.danger+"0d",border:`1px solid ${profit>=0?C.success:C.danger}44`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontSize:28,fontWeight:900,color:profit>=0?C.success:C.danger}}>{profit>=0?"+ ":"− "}{fmt(Math.abs(profit))}</div>
                        <div style={{fontSize:13,fontWeight:700,color:profit>=0?C.success:C.danger}}>{profit>=0?"💰 Net Profit":"📉 Net Loss"}</div>
                        <div style={{fontSize:11,color:C.muted,marginTop:2}}>Sales {fmt(rTotals.total)} − Expenses {fmt(totalExp)}</div>
                      </div>
                      <div style={{fontSize:40}}>{profit>=0?"🚀":"😬"}</div>
                    </div>
                  </Card>
                </>
              );
            })()}
            {/* ── Payment Split ── */}
            {(()=>{
              const mixBills=fBills.filter(b=>b.paymentMode==="Mix");
              const cashOnly=fBills.filter(b=>b.paymentMode==="Cash").reduce((s,b)=>s+b.total,0);
              const upiOnly=fBills.filter(b=>b.paymentMode==="UPI").reduce((s,b)=>s+b.total,0);
              const mixCash=mixBills.reduce((s,b)=>s+(b.cashAmt||0),0);
              const mixUpi=mixBills.reduce((s,b)=>s+(b.upiAmt||0),0);
              const totalCash=cashOnly+mixCash;
              const totalUpi=upiOnly+mixUpi;
              const tot=totalCash+totalUpi||1;
              const cashPct=Math.round(totalCash/tot*100);
              const upiPct=100-cashPct;
              return (
                <Card style={{marginBottom:10}}>
                  <div style={{fontWeight:700,marginBottom:10,fontSize:14}}>💳 Payment Split</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                    {[
                      {l:"💵 Cash",v:totalCash,sub:`${fBills.filter(b=>b.paymentMode==="Cash").length} cash + ${mixBills.length} mix bills`,c:C.success},
                      {l:"📱 UPI",v:totalUpi,sub:`${fBills.filter(b=>b.paymentMode==="UPI").length} upi + ${mixBills.length} mix bills`,c:C.info},
                    ].map(({l,v,sub,c})=>(
                      <div key={l} style={{textAlign:"center",padding:"12px 8px",borderRadius:8,background:c+"0d",border:`1px solid ${c}33`}}>
                        <div style={{fontSize:20,fontWeight:800,color:c}}>{fmt(v)}</div>
                        <div style={{fontSize:12,fontWeight:700,color:c,marginBottom:2}}>{l}</div>
                        <div style={{fontSize:10,color:C.muted,lineHeight:1.3}}>{sub}</div>
                      </div>
                    ))}
                  </div>
                  {mixBills.length>0 && (
                    <div style={{fontSize:11,color:C.muted,marginBottom:8,padding:"6px 10px",background:C.warn+"0d",borderRadius:6,border:`1px solid ${C.warn}22`}}>
                      🔀 {mixBills.length} mix bill{mixBills.length!==1?"s":""} auto-split: {fmt(mixCash)} cash + {fmt(mixUpi)} UPI (already included above)
                    </div>
                  )}
                  {/* Progress bar */}
                  <div style={{height:8,borderRadius:4,overflow:"hidden",background:C.border,display:"flex"}}>
                    <div style={{width:cashPct+"%",background:C.success,transition:"width .4s"}}/>
                    <div style={{width:upiPct+"%",background:C.info,transition:"width .4s"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.muted,marginTop:4}}>
                    <span style={{color:C.success}}>Cash {cashPct}%</span>
                    <span style={{color:C.info}}>UPI {upiPct}%</span>
                  </div>
                </Card>
              );
            })()}
            {/* ── Top Selling Items ── */}
            {(()=>{
              const counts={};
              fBills.forEach(b=>b.items.forEach(i=>{
                if(!counts[i.name]) counts[i.name]={name:i.name,qty:0,rev:0};
                counts[i.name].qty+=i.qty;
                counts[i.name].rev+=i.price*i.qty;
              }));
              const top=Object.values(counts).sort((a,b)=>b.qty-a.qty).slice(0,8);
              if(!top.length) return null;
              const maxQty=top[0]?.qty||1;
              return (
                <Card style={{marginBottom:10}}>
                  <div style={{fontWeight:700,marginBottom:12,fontSize:14}}>🏆 Top Selling Items</div>
                  {top.map((item,idx)=>(
                    <div key={item.name} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <div style={{fontSize:12,fontWeight:700,color:idx===0?C.accent:C.muted,minWidth:18}}>#{idx+1}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</div>
                        <div style={{height:6,borderRadius:3,background:C.border,overflow:"hidden"}}>
                          <div style={{width:(item.qty/maxQty*100)+"%",height:"100%",background:idx===0?C.accent:C.accent+"66",borderRadius:3,transition:"width .4s"}}/>
                        </div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontSize:12,fontWeight:700,color:C.accent}}>{item.qty} sold</div>
                        <div style={{fontSize:11,color:C.muted}}>{fmt(item.rev)}</div>
                      </div>
                    </div>
                  ))}
                </Card>
              );
            })()}
            {(rRange==="week"||rRange==="month"||rRange==="custom") && (
              <Card>
                <div style={{fontWeight:700,marginBottom:10}}>Daily Breakdown</div>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
                    {["Date","Bills","Cash","UPI","Total"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:11,color:C.muted,fontWeight:700}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {Object.entries(fBills.reduce((acc,b)=>{
                      if(!acc[b.date]) acc[b.date]={bills:0,cash:0,upi:0,total:0};
                      acc[b.date].bills++;
                      if(b.paymentMode==="Cash") acc[b.date].cash+=b.total;
                      else if(b.paymentMode==="UPI") acc[b.date].upi+=b.total;
                      else if(b.paymentMode==="Mix"){acc[b.date].cash+=(b.cashAmt||0);acc[b.date].upi+=(b.upiAmt||0);}
                      acc[b.date].total+=b.total;
                      return acc;
                    },{})).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,d])=>(
                      <tr key={date} style={{borderBottom:`1px solid ${C.border}33`}}>
                        <td style={{padding:"7px 10px",fontWeight:600}}>{date}</td>
                        <td style={{padding:"7px 10px",color:C.muted}}>{d.bills}</td>
                        <td style={{padding:"7px 10px",color:C.success,fontWeight:d.cash?600:400}}>{d.cash?fmt(d.cash):"—"}</td>
                        <td style={{padding:"7px 10px",color:C.info,fontWeight:d.upi?600:400}}>{d.upi?fmt(d.upi):"—"}</td>
                        <td style={{padding:"7px 10px",fontWeight:800}}>{fmt(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )
      )}

      {/* ════ QR ORDERS ════ */}
      {tab==="qr" && (
        <div className="fade-up">
          <div style={{fontFamily:"Playfair Display",fontSize:20,marginBottom:14}}>QR Table Ordering</div>
          <Card style={{marginBottom:16,background:C.info+"0d",border:`1px solid ${C.info}33`}}>
            <div style={{fontWeight:700,color:C.info,marginBottom:6}}>📱 How it works</div>
            <div style={{fontSize:13,color:C.muted,lineHeight:1.8}}>
              1. Print QR codes from the Tables tab<br/>
              2. Customer scans, registers name &amp; phone<br/>
              3. Order appears here instantly with a beep<br/>
              4. Accept to merge into table bill, or Reject
            </div>
          </Card>
          <div style={{marginBottom:14}}>
            <div style={{fontWeight:700,marginBottom:8}}>Generate Table QR Codes</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {tables.map(t=>(
                <Btn key={t.id} v="dark" size="sm" onClick={()=>setQrView(t.id)}>QR T{t.id}</Btn>
              ))}
            </div>
          </div>
          {qrOrders.length===0 ? (
            <Card style={{textAlign:"center",padding:40,color:C.muted}}>No incoming QR orders right now</Card>
          ) : (
            qrOrders.map(order=>(
              <Card key={order._key} style={{marginBottom:12,border:`2px solid ${C.warn}55`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15}}>Table {order.tableId} · {order.custName}</div>
                    <div style={{fontSize:12,color:C.muted}}>{order.custPhone} · {order.time}</div>
                  </div>
                  <span style={{fontWeight:800,color:C.accent,fontSize:16}}>{fmt((order.items||[]).reduce((s,i)=>s+i.price*i.qty,0))}</span>
                </div>
                <div style={{marginBottom:10}}>
                  {order.items.map((item,i)=>(
                    <div key={i} style={{fontSize:13,padding:"3px 0",borderBottom:`1px solid ${C.border}22`}}>
                      {item.name} × {item.qty} — {fmt(item.price*item.qty)}
                    </div>
                  ))}
                </div>
                {order.note && <div style={{fontSize:12,color:C.warn,marginBottom:10}}>📝 {order.note}</div>}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <Btn v="danger" onClick={()=>rejectIncoming(order)}>✕ Reject</Btn>
                  <Btn v="success" onClick={()=>acceptIncoming(order)}>✓ Accept</Btn>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* ════ EXPENSES ════ */}
      {tab==="expenses" && (
        !isAdmin ? (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 20px",textAlign:"center"}}>
            <div style={{fontSize:56,marginBottom:16}}>🔒</div>
            <div style={{fontFamily:"Playfair Display",fontSize:22,marginBottom:8}}>Admin Access Required</div>
            <Btn v="primary" onClick={()=>setAdminModal(true)}>Enter Admin Mode</Btn>
          </div>
        ) : (
          <div className="fade-up">
            <div style={{fontFamily:"Playfair Display",fontSize:20,marginBottom:14}}>💸 Expenditure</div>
            {/* Add Expense */}
            <Card style={{marginBottom:14}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>➕ Add Expense</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <div>
                  <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Category</label>
                  <select value={newExp.cat} onChange={e=>setNewExp(x=>({...x,cat:e.target.value}))} style={{marginTop:4,fontSize:13,padding:"8px 10px",width:"100%",borderRadius:8,border:`1px solid ${C.border}`,background:C.card}}>
                    {expCats.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Amount ₹</label>
                  <input style={{marginTop:4}} type="number" placeholder="0" value={newExp.amount} onChange={e=>setNewExp(x=>({...x,amount:e.target.value}))}/>
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Description (optional)</label>
                <input style={{marginTop:4}} placeholder="e.g. Paneer 2kg from supplier" value={newExp.desc} onChange={e=>setNewExp(x=>({...x,desc:e.target.value}))}/>
              </div>
              <Btn full v="primary" onClick={async()=>{
                if(!newExp.amount||isNaN(Number(newExp.amount))){notify("Enter a valid amount","danger");return;}
                const exp={cat:newExp.cat,desc:newExp.desc,amount:Number(newExp.amount),date:todayStr(),time:nowStr(),_ts:Date.now()};
                await fbPush("expenses",exp);
                notify("Expense added: "+fmt(exp.amount)+" in "+exp.cat);
                setNewExp(x=>({...x,desc:"",amount:""}));
              }}>💾 Add Expense</Btn>
            </Card>
            {/* Manage categories */}
            <Card style={{marginBottom:14}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>📂 Expense Categories</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                {expCats.map(c=>(
                  <div key={c} style={{display:"flex",alignItems:"center",gap:4,background:C.surface,borderRadius:20,padding:"4px 10px",border:`1px solid ${C.border}`}}>
                    <span style={{fontSize:12,fontWeight:600}}>{c}</span>
                    <button onClick={()=>{if(window.confirm("Remove category '"+c+"'?"))saveExpCats(expCats.filter(x=>x!==c));}}
                      style={{background:"none",border:"none",color:C.danger,cursor:"pointer",fontSize:13,lineHeight:1,padding:"0 2px"}}>✕</button>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:6}}>
                <input placeholder="New category" id="new-exp-cat" style={{fontSize:12,padding:"6px 10px",flex:1}}
                  onKeyDown={e=>{if(e.key==="Enter"&&e.target.value.trim()){saveExpCats([...expCats,e.target.value.trim()]);e.target.value="";}}}/>
                <Btn size="sm" onClick={()=>{const el=document.getElementById("new-exp-cat");if(el?.value.trim()){saveExpCats([...expCats,el.value.trim()]);el.value="";}}}> + Add</Btn>
              </div>
            </Card>
            {/* Expense history */}
            {(()=>{
              const fExp=expenses.filter(e=>{
                const d=toISO(e.date);
                if(expFilter==="today") return d===todayISO;
                if(expFilter==="yesterday") return d===yesterdayISO;
                if(expFilter==="week"){const w=new Date(Date.now()-7*86400000).toISOString().slice(0,10);return d>=w&&d<=todayISO;}
                if(expFilter==="month"){const m=new Date(Date.now()-30*86400000).toISOString().slice(0,10);return d>=m&&d<=todayISO;}
                if(expFilter==="custom") return d>=expCustomFrom&&d<=expCustomTo;
                return true;
              });
              const totalExp=fExp.reduce((s,e)=>s+e.amount,0);
              const byCat=fExp.reduce((acc,e)=>{acc[e.cat]=(acc[e.cat]||0)+e.amount;return acc;},{});
              return (
                <>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                    {["today","yesterday","week","month","custom"].map(r=>(
                      <button key={r} onClick={()=>setExpFilter(r)}
                        style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${expFilter===r?C.accent:C.border}`,background:expFilter===r?C.accent:"transparent",color:expFilter===r?"#fff":C.muted,fontWeight:600,fontSize:12,cursor:"pointer"}}>
                        {r==="today"?"Today":r==="yesterday"?"Yesterday":r==="week"?"This Week":r==="month"?"This Month":"Custom"}
                      </button>
                    ))}
                  </div>
                  {expFilter==="custom" && (
                    <div style={{display:"flex",gap:10,marginBottom:12,alignItems:"center"}}>
                      <input type="date" value={expCustomFrom} onChange={e=>setExpCustomFrom(e.target.value)} style={{maxWidth:160}}/>
                      <span style={{color:C.muted}}>to</span>
                      <input type="date" value={expCustomTo} onChange={e=>setExpCustomTo(e.target.value)} style={{maxWidth:160}}/>
                    </div>
                  )}
                  <Card style={{marginBottom:12,background:C.danger+"08",border:`1px solid ${C.danger}33`}}>
                    <div style={{fontSize:24,fontWeight:800,color:C.danger}}>{fmt(totalExp)}</div>
                    <div style={{fontSize:11,color:C.muted}}>Total Expenses · {fExp.length} entries</div>
                    {Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>(
                      <div key={cat} style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:13}}>
                        <span style={{color:C.muted}}>{cat}</span>
                        <span style={{fontWeight:700,color:C.danger}}>{fmt(amt)}</span>
                      </div>
                    ))}
                  </Card>
                  {fExp.length===0 ? (
                    <Card style={{textAlign:"center",padding:32,color:C.muted}}>No expenses recorded for this period</Card>
                  ) : (
                    <Card style={{padding:0,overflow:"hidden"}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr style={{background:C.surface}}>
                          {["Date","Category","Description","Amount",""].map(h=>(
                            <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {fExp.map((e,i)=>(
                            <tr key={i} style={{borderBottom:`1px solid ${C.border}33`}}>
                              <td style={{padding:"9px 12px",fontSize:12,color:C.muted}}>{e.date}</td>
                              <td style={{padding:"9px 12px",fontSize:12,fontWeight:600}}>{e.cat}</td>
                              <td style={{padding:"9px 12px",fontSize:12,color:C.muted}}>{e.desc||"—"}</td>
                              <td style={{padding:"9px 12px",fontWeight:800,color:C.danger}}>{fmt(e.amount)}</td>
                              <td style={{padding:"9px 12px"}}>
                                <Btn size="sm" v="danger" onClick={()=>{
                                  if(!window.confirm("Delete this expense?")) return;
                                  if(e._key) fetch(`${FB}/cafes/kaka-main/expenses/${e._key}.json`,{method:"DELETE"});
                                  setExpenses(prev=>prev.filter(x=>x._key!==e._key));
                                }}>✕</Btn>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Card>
                  )}
                </>
              );
            })()}
          </div>
        )
      )}

      {/* ════ CUSTOMERS (admin only) ════ */}
      {tab==="customers" && (
        !isAdmin ? (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 20px",textAlign:"center"}}>
            <div style={{fontSize:56,marginBottom:16}}>🔒</div>
            <div style={{fontFamily:"Playfair Display",fontSize:22,marginBottom:8}}>Admin Access Required</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:24}}>Customer database is restricted to admin only</div>
            <Btn v="primary" onClick={()=>setAdminModal(true)}>Enter Admin Mode</Btn>
          </div>
        ) : (
          <div className="fade-up">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div>
                <div style={{fontFamily:"Playfair Display",fontSize:20}}>Customer Database</div>
                <div style={{fontSize:12,color:C.muted}}>{customers.length} customers</div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{
                  if(!customers.length){notify("No customers yet","danger");return;}
                  const esc=v=>{const s=String(v??"");return(s.includes(",")||s.includes('"'))?'"'+s.replace(/"/g,'""')+'"':s;};
                  const HDR="Name,Phone,Visits,First Visit,Last Visit,Last Table,Note";
                  const rows=customers.map(c=>[c.name,c.phone,c.visits||1,c.firstVisit||"",c.lastVisit||"",c.lastTable||"",c.note||""].map(esc).join(",")).join("\n");
                  const blob=new Blob(["\uFEFF"+HDR+"\n"+rows],{type:"text/csv;charset=utf-8"});
                  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`Kaka-Customers-${new Date().toISOString().slice(0,10)}.csv`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
                  notify("Customers exported ✅");
                }} style={{background:C.success,color:"#fff",border:"none",borderRadius:8,padding:"7px 14px",fontWeight:700,fontSize:12,cursor:"pointer"}}>📥 Export CSV</button>
                <Btn onClick={()=>setEditCust({id:null,name:"",phone:"",note:""})}>+ Add</Btn>
              </div>
            </div>
            <input value={custSearch} onChange={e=>setCustSearch(e.target.value)} placeholder="Search by name or phone..." style={{maxWidth:320,marginBottom:14}}/>
            {customers.length===0 ? (
              <Card style={{textAlign:"center",padding:40,color:C.muted}}>No customers yet. They appear after QR orders.</Card>
            ) : (
              <Card style={{padding:0,overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr style={{background:C.surface}}>
                    {["Name","Phone","Visits","Last Visit","Last Table","Note",""].map(h=>(
                      <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {customers.filter(c=>!custSearch||(c.name+c.phone).toLowerCase().includes(custSearch.toLowerCase())).map(c=>(
                      <tr key={c.phone} style={{borderBottom:`1px solid ${C.border}33`}}>
                        <td style={{padding:"9px 12px",fontWeight:600}}>{c.name}</td>
                        <td style={{padding:"9px 12px",color:C.muted,fontSize:12}}>{c.phone}</td>
                        <td style={{padding:"9px 12px",fontWeight:700,color:C.accent}}>{c.visits||1}</td>
                        <td style={{padding:"9px 12px",fontSize:12,color:C.muted}}>{c.lastVisit||"—"}</td>
                        <td style={{padding:"9px 12px",color:C.muted}}>T{c.lastTable||"—"}</td>
                        <td style={{padding:"9px 12px",fontSize:12,color:C.muted,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis"}}>{c.note||"—"}</td>
                        <td style={{padding:"9px 12px"}}>
                          <div style={{display:"flex",gap:4}}>
                            <Btn size="sm" v="ghost" onClick={()=>setEditCust({...c})}>Edit</Btn>
                            {c.phone && <Btn size="sm" v="success" onClick={()=>sendWhatsApp(c.phone,`Hi ${c.name}! Visit us at Kaka Cafe 😊`)}>📲</Btn>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )
      )}

      </div>{/* end padding div */}



      {/* ════ MODALS ════ */}

      {/* Incoming QR order popup — fixed overlay, never blanks app */}
      {incomingOrder && incomingOrder.items?.length > 0 && (
        <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:C.card,borderRadius:16,padding:20,maxWidth:420,width:"100%",border:`2px solid ${C.warn}`,boxShadow:"0 24px 60px #00000044",maxHeight:"80vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontFamily:"Playfair Display",fontSize:18}}>🔔 New QR Order!</div>
              <span style={{background:C.warn,color:"#fff",borderRadius:20,padding:"3px 10px",fontSize:12,fontWeight:700}}>Table {incomingOrder.tableId}</span>
            </div>
            <div style={{fontSize:13,color:C.muted,marginBottom:10}}>{incomingOrder.custName||"Guest"} · {incomingOrder.custPhone||""}</div>
            <div style={{marginBottom:10}}>
              {(incomingOrder.items||[]).map((item,i)=>(
                <div key={i} style={{fontSize:13,padding:"5px 0",borderBottom:`1px solid ${C.border}22`,display:"flex",justifyContent:"space-between"}}>
                  <span>{item.name} × {item.qty}</span><span style={{fontWeight:700,color:C.accent}}>{fmt(item.price*item.qty)}</span>
                </div>
              ))}
            </div>
            <div style={{fontWeight:800,fontSize:15,marginBottom:10,borderTop:`1px solid ${C.border}`,paddingTop:8}}>
              Total: {fmt((incomingOrder.items||[]).reduce((s,i)=>s+i.price*i.qty,0))}
            </div>
            {incomingOrder.note && <div style={{fontSize:12,color:C.warn,marginBottom:10}}>📝 {incomingOrder.note}</div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <Btn v="danger" onClick={()=>rejectIncoming(incomingOrder)}>✕ Reject</Btn>
              <Btn v="success" onClick={()=>{
                const order=incomingOrder;
                acceptIncoming(order);
                // No confirm dialog — just accept silently
                // Staff can use the WhatsApp button below if needed
              }}>✓ Accept</Btn>
            </div>
            {incomingOrder.custPhone && (
              <Btn full v="success" size="sm" onClick={(e)=>{
                const bill={billNo:"(order rcvd)",table:incomingOrder.tableId,items:incomingOrder.items||[],subtotal:(incomingOrder.items||[]).reduce((s,i)=>s+i.price*i.qty,0),gst:0,packaging:0,total:(incomingOrder.items||[]).reduce((s,i)=>s+i.price*i.qty,0),paymentMode:"UPI",cashAmt:0,upiAmt:(incomingOrder.items||[]).reduce((s,i)=>s+i.price*i.qty,0),custName:incomingOrder.custName,custPhone:incomingOrder.custPhone,date:todayStr(),time:nowStr()};
                sendWhatsApp(incomingOrder.custPhone,buildWhatsAppMsg(bill));
                e.currentTarget.textContent="✅ Sent!";
                e.currentTarget.disabled=true;
                e.currentTarget.style.opacity="0.6";
              }}>📲 Send WhatsApp Confirmation</Btn>
            )}
          </div>
        </div>
      )}

      {/* ════ CONTACTS SYNC ════ */}
      {tab==="contacts" && (
        <div className="fade-up">
          <div style={{fontFamily:"Playfair Display",fontSize:20,marginBottom:4}}>📇 Contacts Sync</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:16}}>
            Upload your OnePlus contacts export (VCF or CSV). We'll compare with your {customers.length} Kaka Cafe customers
            and generate a VCF file with new contacts to import back to your phone.
          </div>

          {/* Upload area */}
          <Card style={{marginBottom:16,padding:20,textAlign:"center",border:`2px dashed ${C.border}`}}>
            <div style={{fontSize:32,marginBottom:8}}>📤</div>
            <div style={{fontWeight:700,marginBottom:4}}>Upload Phone Contacts Export</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:16}}>Supports .vcf (vCard) and .csv files from OnePlus / Google Contacts</div>
            <input type="file" accept=".vcf,.csv,.xlsx,.xls" style={{display:"none"}} id="contacts-upload"
              onChange={async e=>{
                const file=e.target.files[0];
                if(!file){return;}
                setContactsLoading(true);
                setContactsResult(null);
                try {
                  const text=await file.text();
                  const ext=file.name.split(".").pop().toLowerCase();

                  // Parse phone contacts from file
                  let phoneContacts=[]; // [{name, phone}]

                  if(ext==="vcf"){
                    // Parse VCF / vCard format
                    const cards=text.split("BEGIN:VCARD");
                    cards.forEach(card=>{
                      if(!card.trim()) return;
                      // Extract name
                      const fnMatch=card.match(/FN[^:]*:(.+)/);
                      const nMatch=card.match(/N[^:]*:(.+)/);
                      let name=(fnMatch?.[1]||"").trim();
                      if(!name && nMatch){
                        const parts=nMatch[1].split(";").filter(Boolean);
                        name=[parts[1],parts[0]].filter(Boolean).join(" ").trim();
                      }
                      // Extract all phone numbers
                      const telMatches=[...card.matchAll(/TEL[^:]*:(.+)/g)];
                      telMatches.forEach(m=>{
                        const raw=m[1].replace(/[^0-9+]/g,"").trim();
                        // Normalize to 10 digits (Indian numbers)
                        let phone=raw;
                        if(phone.startsWith("+91")) phone=phone.slice(3);
                        if(phone.startsWith("91")&&phone.length===12) phone=phone.slice(2);
                        if(phone.length===10) phoneContacts.push({name:name||"Unknown",phone});
                      });
                    });
                  } else if(ext==="csv"){
                    // Parse CSV — handle Google Contacts / OnePlus CSV export
                    const lines=text.split("
").filter(Boolean);
                    const headers=lines[0].split(",").map(h=>h.replace(/"/g,"").trim().toLowerCase());
                    const nameIdx=headers.findIndex(h=>h.includes("name")||h==="first name"||h==="given name");
                    const phoneIdx=headers.findIndex(h=>h.includes("phone")||h.includes("mobile")||h.includes("tel"));
                    lines.slice(1).forEach(line=>{
                      // Handle quoted CSV
                      const cols=[]; let cur="",inQ=false;
                      for(const ch of line){ if(ch==='"'){inQ=!inQ;}else if(ch===","&&!inQ){cols.push(cur);cur="";}else cur+=ch; }
                      cols.push(cur);
                      const name=(cols[nameIdx]||"").replace(/"/g,"").trim();
                      const raw=(cols[phoneIdx]||"").replace(/[^0-9+]/g,"").trim();
                      let phone=raw;
                      if(phone.startsWith("+91")) phone=phone.slice(3);
                      if(phone.startsWith("91")&&phone.length===12) phone=phone.slice(2);
                      if(phone.length===10) phoneContacts.push({name,phone});
                    });
                  }

                  // Build set of phone numbers already in phone contacts
                  const phoneNums=new Set(phoneContacts.map(c=>c.phone));
                  // Build set of Kaka Cafe customer phones
                  const cafeNums=new Set(customers.map(c=>c.phone));

                  // New Kaka Cafe customers NOT in phone contacts
                  const newToPhone=customers.filter(c=>c.phone&&!phoneNums.has(c.phone));
                  // Phone contacts not in Kaka Cafe (just for info)
                  const notInCafe=phoneContacts.filter(c=>!cafeNums.has(c.phone));

                  setContactsResult({
                    totalPhone:phoneContacts.length,
                    totalCafe:customers.length,
                    newToPhone,   // cafe customers missing from phone
                    notInCafe,    // phone contacts not in cafe system
                    fileName:file.name,
                  });
                } catch(err){
                  setContactsResult({error:"Could not parse file: "+err.message});
                }
                setContactsLoading(false);
                e.target.value=""; // reset input
              }}/>
            <label htmlFor="contacts-upload" style={{display:"inline-block",padding:"10px 28px",
              background:C.accent,color:"#fff",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:14}}>
              Choose File
            </label>
            <div style={{fontSize:11,color:C.muted,marginTop:8}}>
              On OnePlus: Contacts app → Menu → Import/Export → Export to storage → .vcf file
            </div>
          </Card>

          {contactsLoading && (
            <Card style={{textAlign:"center",padding:32,color:C.muted}}>
              <div style={{fontSize:24,marginBottom:8}}>⏳</div>
              Parsing contacts...
            </Card>
          )}

          {contactsResult?.error && (
            <Card style={{padding:16,background:C.danger+"11",border:`1px solid ${C.danger}33`,color:C.danger}}>
              ❌ {contactsResult.error}
            </Card>
          )}

          {contactsResult && !contactsResult.error && (()=>{
            const {totalPhone,totalCafe,newToPhone,notInCafe,fileName}=contactsResult;
            return (
              <>
                {/* Summary cards */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
                  {[
                    {l:"📱 Phone Contacts",v:totalPhone,c:C.info},
                    {l:"☕ Cafe Customers",v:totalCafe,c:C.accent},
                    {l:"✨ New to Add",v:newToPhone.length,c:C.success},
                  ].map(({l,v,c})=>(
                    <Card key={l} style={{textAlign:"center",padding:14,border:`1px solid ${c}33`}}>
                      <div style={{fontSize:22,fontWeight:900,color:c}}>{v}</div>
                      <div style={{fontSize:11,color:C.muted,fontWeight:600}}>{l}</div>
                    </Card>
                  ))}
                </div>

                {newToPhone.length===0 ? (
                  <Card style={{textAlign:"center",padding:32,color:C.success}}>
                    <div style={{fontSize:28,marginBottom:8}}>✅</div>
                    <div style={{fontWeight:700}}>All cafe customers are already in your phone!</div>
                    <div style={{fontSize:12,color:C.muted,marginTop:4}}>Nothing new to add.</div>
                  </Card>
                ) : (
                  <Card style={{marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                      <div style={{fontWeight:700,fontSize:15}}>✨ {newToPhone.length} new customer{newToPhone.length!==1?"s":""} to add to phone</div>
                      <Btn v="success" onClick={()=>{
                        // Generate VCF file for import
                        const vcf=newToPhone.map(c=>{
                          const name=c.name||("Kaka Customer "+c.phone);
                          return [
                            "BEGIN:VCARD",
                            "VERSION:3.0",
                            `FN:${name}`,
                            `N:${name};;;`,
                            `TEL;TYPE=CELL:+91${c.phone}`,
                            `NOTE:Kaka Cafe customer. Visits: ${c.visits||1}. First visit: ${c.firstVisit||""}`,
                            "END:VCARD"
                          ].join("
");
                        }).join("
");
                        const blob=new Blob([vcf],{type:"text/vcard"});
                        const a=document.createElement("a");
                        a.href=URL.createObjectURL(blob);
                        a.download=`kaka-new-contacts-${new Date().toLocaleDateString("en-IN").replace(/\//g,"-")}.vcf`;
                        a.click();
                        notify("VCF downloaded — import to your phone contacts!");
                      }}>📥 Download VCF to Import</Btn>
                    </div>
                    <div style={{maxHeight:320,overflowY:"auto"}}>
                      {newToPhone.map((c,i)=>(
                        <div key={c.phone} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                          padding:"8px 0",borderBottom:`1px solid ${C.border}33`,fontSize:13}}>
                          <div>
                            <span style={{fontWeight:700}}>{c.name||"—"}</span>
                            <span style={{color:C.muted,marginLeft:8}}>+91 {c.phone}</span>
                          </div>
                          <div style={{fontSize:11,color:C.muted}}>
                            {c.visits||1} visit{(c.visits||1)!==1?"s":""} · last {c.lastVisit||""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {notInCafe.length>0 && (
                  <Card style={{marginBottom:16}}>
                    <div style={{fontWeight:700,marginBottom:8,fontSize:14,color:C.muted}}>
                      📵 {notInCafe.length} phone contacts not in Kaka Cafe system
                    </div>
                    <div style={{fontSize:12,color:C.muted}}>
                      These are in your phone but never ordered at Kaka Cafe (or ordered without giving phone number).
                    </div>
                  </Card>
                )}

                <div style={{fontSize:11,color:C.muted,textAlign:"center"}}>
                  Analysed from: {fileName}
                </div>
              </>
            );
          })()}

          {!contactsResult && !contactsLoading && (
            <Card style={{padding:20}}>
              <div style={{fontWeight:700,marginBottom:10,fontSize:14}}>📖 How to use:</div>
              <div style={{fontSize:13,color:C.text,lineHeight:1.8}}>
                <div>1. On your OnePlus: open <strong>Contacts</strong> app</div>
                <div>2. Tap <strong>Menu (⋮)</strong> → <strong>Manage contacts</strong> → <strong>Export contacts</strong></div>
                <div>3. Save the <strong>.vcf file</strong> to your phone storage</div>
                <div>4. Transfer to your PC and upload here</div>
                <div>5. Download the generated VCF with new customers</div>
                <div>6. Transfer back to phone → open file → tap <strong>Import</strong></div>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Diagnostic modal */}
      {diagData && (
        <Modal title="🔍 Firebase Diagnostic" onClose={()=>setDiagData(null)} width={480}>
          <div style={{fontFamily:"monospace",fontSize:12}}>
            <div style={{marginBottom:8}}>
              <strong>HTTP Status:</strong> {diagData.status||"—"}
              {diagData.error && <span style={{color:C.danger}}> ERROR: {diagData.error}</span>}
            </div>
            <div style={{marginBottom:8}}>
              <strong>Firebase paths found:</strong> {diagData.keys?.join(", ")||"none"}
            </div>
            <div style={{marginBottom:12,color:C.muted,wordBreak:"break-all"}}>
              <strong>Raw response:</strong><br/>{diagData.raw||"—"}
            </div>
            <div style={{marginBottom:8,fontFamily:"DM Sans,sans-serif"}}>
              <strong>App state:</strong> {bills.length} bills · {menu.length} menu items · {customers.length} customers
            </div>
            <Btn full v="primary" onClick={async()=>{
              // Force reload all data
              try {
                const [b,m,c,s]=await Promise.all([
                  fetch(`${FB_BASE}/bills.json`,{cache:"no-store"}).then(r=>r.json()).catch(()=>null),
                  fetch(`${FB_BASE}/menu.json`,{cache:"no-store"}).then(r=>r.json()).catch(()=>null),
                  fetch(`${FB_BASE}/customers.json`,{cache:"no-store"}).then(r=>r.json()).catch(()=>null),
                  fetch(`${FB_BASE}/settings.json`,{cache:"no-store"}).then(r=>r.json()).catch(()=>null),
                ]);
                setDiagData(prev=>({...prev,
                  bills: b?`${Object.keys(b).length} records`:String(b),
                  menu: m?`${Object.keys(m).length} records`:String(m),
                  customers: c?`${Object.keys(c).length} records`:String(c),
                  settings: s?Object.keys(s).join(", "):String(s),
                }));
              } catch(e){ setDiagData(prev=>({...prev,fetchError:e.message})); }
            }}>🔄 Test All Paths</Btn>
            {diagData.bills && <div style={{marginTop:8,fontSize:11}}>Bills: {diagData.bills}</div>}
            {diagData.menu && <div style={{fontSize:11}}>Menu: {diagData.menu}</div>}
            {diagData.customers && <div style={{fontSize:11}}>Customers: {diagData.customers}</div>}
            {diagData.settings && <div style={{fontSize:11}}>Settings keys: {diagData.settings}</div>}
          </div>
        </Modal>
      )}

      {/* QR Code modal */}
      {qrView && <QRModal tableId={qrView} info={info} onClose={()=>setQrView(null)}/>}

      {/* Print bill modal */}
      {printBill && (
        <Modal title={`Bill ${printBill.billNo}`} onClose={()=>setPrintBill(null)} width={400}>
          <div style={{background:"#fff",color:"#111",borderRadius:8,padding:"18px 16px",fontFamily:"monospace",fontSize:13}}>
            <div style={{textAlign:"center",marginBottom:10}}>
              <div style={{fontSize:20,fontWeight:900,letterSpacing:2}}>{info.name.toUpperCase()}</div>
              <div style={{fontSize:11}}>{info.tagline}</div>
              <div style={{fontSize:11}}>{info.phone} | {info.hours}</div>
            </div>
            <div style={{borderTop:"1px dashed #999",borderBottom:"1px dashed #999",padding:"8px 0",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span>Bill No:</span><span>{printBill.billNo}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span>Table:</span><span>{printBill.table}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span>Date:</span><span>{printBill.date}</span></div>
              {printBill.custName && <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}><span>Customer:</span><span>{printBill.custName}</span></div>}
            </div>
            {printBill.items.map((item,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:12}}>
                <span>{item.name} × {item.qty}</span>
                <span>{fmt(item.price*item.qty)}</span>
              </div>
            ))}
            <div style={{borderTop:"1px dashed #999",marginTop:8,paddingTop:8}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span>Subtotal</span><span>{fmt(printBill.subtotal)}</span></div>
              {printBill.gst>0 && <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span>GST (5%)</span><span>{fmt(printBill.gst)}</span></div>}
              {printBill.packaging>0 && <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}><span>Packaging</span><span>{fmt(printBill.packaging)}</span></div>}
              <div style={{display:"flex",justifyContent:"space-between",fontWeight:900,fontSize:15,marginTop:4}}><span>TOTAL</span><span>{fmt(printBill.total)}</span></div>
              <div style={{fontSize:11,marginTop:4}}>Payment: {printBill.paymentMode}</div>
            </div>
            {info.upiId && printBill.paymentMode!=="Cash" && (
              <div style={{textAlign:"center",marginTop:12}}>
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(`upi://pay?pa=${info.upiId}&am=${printBill.paymentMode==="Mix"?(printBill.upiAmt||printBill.total):printBill.total}&cu=INR`)}`} width={120} height={120} alt="UPI QR"/>
                <div style={{fontSize:11,marginTop:4}}>Scan to pay via UPI</div>
              </div>
            )}
            <div style={{textAlign:"center",marginTop:12,borderTop:"1px dashed #999",paddingTop:8,fontSize:11}}>
              <div>Thank you for visiting {info.name}! 🙏</div>
              <div>Follow us: {info.email}</div>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:12}}>
            {printBill.custPhone ? (
              <Btn full v="success" size="lg" onClick={()=>sendWhatsApp(printBill.custPhone,buildWhatsAppMsg(printBill))}>
                📲 Send Bill on WhatsApp
              </Btn>
            ) : (
              <div>
                <div style={{display:"flex",gap:6,marginBottom:6}}>
                  <input id="wa-phone-input" placeholder="Enter customer phone to WhatsApp bill" type="tel" maxLength={10}
                    style={{flex:1,fontSize:12,padding:"8px 10px",borderRadius:8,border:`1px solid ${C.border}`}}
                    onKeyDown={e=>{if(e.key==="Enter"){const v=e.target.value.replace(/\D/g,"").slice(0,10);if(v.length===10)sendWhatsApp(v,buildWhatsAppMsg(printBill));}}}
                  />
                  <Btn v="success" onClick={()=>{const el=document.getElementById("wa-phone-input");const v=(el?.value||"").replace(/\D/g,"").slice(0,10);if(v.length===10)sendWhatsApp(v,buildWhatsAppMsg(printBill));else alert("Enter 10-digit phone number");}}>📲</Btn>
                </div>
              </div>
            )}
            <Btn full v="dark" onClick={()=>window.print()}>🖨 Print Bill</Btn>
          </div>
        </Modal>
      )}

      {/* Add menu item modal */}
      {modal==="addItem" && (
        <Modal title="Add Menu Item" onClose={()=>setModal(null)}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <input placeholder="Item name" value={newItem.name} onChange={e=>setNewItem(x=>({...x,name:e.target.value}))}/>
            <select value={newItem.cat} onChange={e=>setNewItem(x=>({...x,cat:e.target.value}))}>
              {cats.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <input placeholder="Price ₹" type="number" value={newItem.price} onChange={e=>setNewItem(x=>({...x,price:e.target.value}))}/>
            <Btn full onClick={()=>{
              if(!newItem.name||!newItem.price){notify("Fill all fields","danger");return;}
              const newMenuItem={id:Date.now(),name:newItem.name,cat:newItem.cat,price:Number(newItem.price),recipe:[]};
              saveMenu([...menu,newMenuItem]);
              setNewItem({name:"",cat:"Quick Bites",price:""});
              setModal(null);notify("Item added!");
            }}>Add Item</Btn>
          </div>
        </Modal>
      )}

      {/* Recipe modal */}
      {modal==="recipe" && mdata && (
        <Modal title={`Recipe: ${mdata.name}`} onClose={()=>setModal(null)}>
          {mdata.recipe?.length ? (
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>{["Ingredient","Quantity"].map(h=><th key={h} style={{padding:"8px",textAlign:"left",borderBottom:`1px solid ${C.border}`,fontSize:11,color:C.muted,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
              <tbody>
                {mdata.recipe.map((r,i)=>{
                  const ing=ings.find(x=>x.id===r.i);
                  return <tr key={i} style={{borderBottom:`1px solid ${C.border}33`}}>
                    <td style={{padding:"8px"}}>{ing?.name||r.i}</td>
                    <td style={{padding:"8px",color:C.accent,fontWeight:700}}>{r.q} {ing?.unit}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          ) : <div style={{textAlign:"center",color:C.muted,padding:24}}>No recipe defined for this item.</div>}
        </Modal>
      )}

      {/* Edit customer modal */}
      {editCust && (
        <Modal title={editCust.id?"Edit Customer":"Add Customer"} onClose={()=>setEditCust(null)}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <input placeholder="Name" value={editCust.name} onChange={e=>setEditCust(c=>({...c,name:e.target.value}))}/>
            <input placeholder="Phone" type="tel" maxLength={10} value={editCust.phone} onChange={e=>setEditCust(c=>({...c,phone:e.target.value.replace(/\D/g,"").slice(0,10)}))}/>
            <input placeholder="Note (optional)" value={editCust.note||""} onChange={e=>setEditCust(c=>({...c,note:e.target.value}))}/>
            <div style={{display:"flex",gap:8}}>
              <Btn full onClick={()=>{
                if(!editCust.name||editCust.phone.length<10){notify("Name and 10-digit phone required","danger");return;}
                const key="c"+editCust.phone;
                const data={name:editCust.name,phone:editCust.phone,note:editCust.note||"",visits:editCust.visits||1,firstVisit:editCust.firstVisit||todayStr(),lastVisit:editCust.lastVisit||todayStr(),lastTable:editCust.lastTable||""};
                fbSet(`customers/${key}`,data);
                setEditCust(null);notify("Customer saved!");
              }}>Save</Btn>
              {editCust.phone && <Btn v="danger" onClick={()=>{
                if(!confirm("Delete this customer?")) return;
                const key="c"+editCust.phone;
                fetch(`${FB}/cafes/kaka-main/customers/${key}.json`,{method:"DELETE"});
                setCustomers(prev=>prev.filter(c=>c.phone!==editCust.phone));
                setEditCust(null);notify("Deleted","warn");
              }}>Delete</Btn>}
            </div>
          </div>
        </Modal>
      )}

      {/* Settings modal */}
      {modal==="settings" && (
        <Modal title="Settings" onClose={()=>setModal(null)} width={520}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {!isAdmin ? (
              <div style={{textAlign:"center",padding:"30px 0"}}>
                <div style={{fontSize:40,marginBottom:12}}>🔐</div>
                <div style={{fontFamily:"Playfair Display",fontSize:18,marginBottom:8}}>Admin Access Required</div>
                <div style={{fontSize:13,color:C.muted,marginBottom:20}}>All settings are restricted to admin only.</div>
                <Btn v="dark" onClick={()=>{setModal(null);setAdminModal(true);}}>Enter Admin Mode</Btn>
              </div>
            ) : (
              <>
                <div style={{fontWeight:700,color:C.accent,fontSize:11,textTransform:"uppercase",letterSpacing:.8}}>☕ Cafe Info</div>
                {[["name","Cafe Name"],["tagline","Tagline"],["address","Address"],["phone","Phone"],["email","Instagram Handle"],["hours","Opening Hours"]].map(([k,l])=>(
                  <div key={k}>
                    <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{l}</label>
                    <input style={{marginTop:4}} value={info[k]||""} onChange={e=>setInfo(i=>({...i,[k]:e.target.value}))}/>
                  </div>
                ))}
                <div>
                  <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Public URL (for QR codes)</label>
                  <input style={{marginTop:4}} value={info.publicUrl||""} onChange={e=>setInfo(i=>({...i,publicUrl:e.target.value}))} placeholder="https://your-app.pages.dev"/>
                </div>
                <div>
                  <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Kitchen WhatsApp</label>
                  <div style={{fontSize:12,color:C.muted,marginTop:4,padding:"8px 10px",background:C.surface,borderRadius:8,border:`1px solid ${C.border}`}}>
                    KOT button opens WhatsApp share — select your kitchen group from the list. No phone number needed.
                  </div>
                </div>
                <div style={{marginTop:4,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
                  <div style={{fontWeight:700,color:C.warn,fontSize:11,textTransform:"uppercase",letterSpacing:.8,marginBottom:12}}>🔐 Admin Settings</div>
                  {[["upiId","UPI ID (for QR payments)"],["googleReview","Google Review Link"],["gstin","GSTIN"]].map(([k,l])=>(
                    <div key={k} style={{marginBottom:12}}>
                      <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{l}</label>
                      <input style={{marginTop:4}} value={info[k]||""} onChange={e=>setInfo(i=>({...i,[k]:e.target.value}))}/>
                    </div>
                  ))}
                  <div style={{marginBottom:12}}>
                    <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Staff PIN (4 digits)</label>
                    <input style={{marginTop:4}} type="password" maxLength={4} value={info.staffPin||""} onChange={e=>setInfo(i=>({...i,staffPin:e.target.value.replace(/\D/g,"").slice(0,4)}))} placeholder="0000"/>
                    <div style={{fontSize:11,color:C.muted,marginTop:4}}>Default: 0000</div>
                  </div>
                  <div style={{marginBottom:12}}>
                    <label style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Admin Password</label>
                    <input style={{marginTop:4}} type="password" value={info.adminPass||""} onChange={e=>setInfo(i=>({...i,adminPass:e.target.value}))}/>
                  </div>
                  <Btn v="danger" onClick={()=>{
                    if(!confirm("Clear ALL data? Bills, tables, QR orders will be permanently deleted.")) return;
                    fetch(`${FB}/cafes/kaka-main/bills.json`,{method:"DELETE"});
                    fetch(`${FB}/cafes/kaka-main/tables.json`,{method:"DELETE"});
                    fetch(`${FB}/cafes/kaka-main/qrOrders.json`,{method:"DELETE"});
                    setBills([]);setTables(Array.from({length:TABLE_COUNT},(_,i)=>({id:i+1,status:"free",order:[]})));setQrOrders([]);
                    notify("Database cleared","warn");setModal(null);
                  }}>🗑 Clear All Data</Btn>
                </div>
                <Btn full v="success" onClick={async()=>{
                  const settingsData={
                    name:info.name||"Kaka Cafe",
                    kitchenPhone:info.kitchenPhone||"",
                    tagline:info.tagline||"",
                    address:info.address||"",
                    phone:info.phone||"",
                    email:info.email||"",
                    gstin:info.gstin||"",
                    hours:info.hours||"",
                    upiId:info.upiId||"",
                    googleReview:info.googleReview||"",
                    adminPass:info.adminPass||"1234",
                    staffPin:info.staffPin||"0000",
                    publicUrl:info.publicUrl||"",
                  };
                  try {
                    await fbSet("settings",settingsData);
                    try{localStorage.setItem("kaka_public_url",settingsData.publicUrl);}catch(ex){}
                    notify("✅ Settings saved & synced to all devices!"); addLog("SETTINGS_SAVED");
                    setModal(null);
                  } catch(e) {
                    notify("❌ Save failed — check internet connection","danger");
                  }
                }}>💾 Save & Sync to All Devices</Btn>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Admin login modal */}
      {adminModal && (
        <Modal title="Admin Mode" onClose={()=>{setAdminModal(false);setAdminInput("");}} width={360}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>🔐</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:16}}>Enter admin password to unlock reports, customer database, and admin settings.</div>
            <input type="password" placeholder="Admin password" value={adminInput} onChange={e=>setAdminInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"){if(adminInput===(info.adminPass||"1234")){setIsAdmin(true);setAdminModal(false);setAdminInput("");notify("Admin mode unlocked");}else{notify("Wrong password","danger");setAdminInput("");}}}}
              style={{marginBottom:12}}/>
            <Btn full onClick={()=>{
              if(adminInput===(info.adminPass||"1234")){setIsAdmin(true);setAdminModal(false);setAdminInput("");notify("Admin mode unlocked");}
              else{notify("Wrong password","danger");setAdminInput("");}
            }}>Unlock</Btn>
          </div>
        </Modal>
      )}

      {toast && <Toast msg={toast.msg} type={toast.type}/>}

    </div>
  );
}
