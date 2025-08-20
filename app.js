// ---------- JS: College Empty Room Finder (Vanilla) ----------

// ---- Utilities ----
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const fmtTime = (d) => new Date(d).toLocaleString();
const nowLocalISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off*60*1000);
  return local.toISOString().slice(0,16);
};
const debounce = (fn, ms=250) => {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
};

// ---- Mock Auth ----
const auth = {
  get user(){ try{return JSON.parse(localStorage.getItem('erf_user'))}catch{return null} },
  set user(v){ localStorage.setItem('erf_user', JSON.stringify(v)); },
  clear(){ localStorage.removeItem('erf_user'); }
};

// ---- Mock Data Layer ----
/** Demo buildings/rooms. In real app, replace with API calls. */
const DATA = (()=>{
  const departments = ["CSE","ECE","ME","CE","EEE"];
  const equipmentPool = ["Projector","Smart Board","Lab PCs","3D Printer","Audio","AC"];
  const buildings = ["A","B","C"];
  const rooms = [];
  let id = 1;
  for (const b of buildings){
    for (let f=1; f<=3; f++){
      for (let r=1; r<=6; r++){
        const dept = departments[(f+r) % departments.length];
        const capacity = 20 + ((f*10 + r*5) % 120);
        const equipment = [equipmentPool[(r)%equipmentPool.length], equipmentPool[(r+2)%equipmentPool.length]];
        // Create a simple timetable: busy 10:00-12:00 and 14:00-15:30 local
        const today = new Date();
        const y=today.getFullYear(), m=today.getMonth(), d=today.getDate();
        const busySlots = [
          {start: new Date(y,m,d,10,0).toISOString(), end: new Date(y,m,d,12,0).toISOString(), by:"CSE101"},
          {start: new Date(y,m,d,14,0).toISOString(), end: new Date(y,m,d,15,30).toISOString(), by:"ECE210"},
        ];
        rooms.push({
          id: String(id++),
          name: `Bldg ${b} • ${f}0${r}`,
          building: `Building ${b}`,
          floor: f,
          department: dept,
          capacity,
          equipment,
          timetable: busySlots,
          // Simulated sensor state (randomized start)
          sensor: Math.random() < 0.3 ? "occupied" : "empty"
        });
      }
    }
  }
  return {rooms, departments, buildings};
})();

// Bookings storage
const bookings = {
  key: "erf_bookings",
  all(){
    try{ return JSON.parse(localStorage.getItem(this.key)) ?? {}; } catch { return {}; }
  },
  setAll(data){ localStorage.setItem(this.key, JSON.stringify(data)); },
  get(roomId){ return this.all()[roomId]; },
  set(roomId, entry){ const all=this.all(); all[roomId]=entry; this.setAll(all); },
  remove(roomId){ const all=this.all(); delete all[roomId]; this.setAll(all); },
  clear(){ localStorage.removeItem(this.key); }
};

// ---- Availability Logic ----
/** Determine if a room is free at the given Date based on timetable and live sensor */
function availabilityFor(room, atDate, live=true){
  // Check timetable
  const t = atDate.getTime();
  const busyBySchedule = room.timetable.some(slot => {
    const start = new Date(slot.start).getTime();
    const end = new Date(slot.end).getTime();
    return t >= start && t < end;
  });
  // Booking overrides (treat as busy)
  const b = bookings.get(room.id);
  const busyByBooking = !!b && t >= new Date(b.start).getTime() && t < new Date(b.end).getTime();

  if (live){
    // If sensor says occupied, it's busy; otherwise defer to timetable/booking
    const busyBySensor = room.sensor === "occupied";
    const isFree = !busyBySensor && !busyBySchedule && !busyByBooking;
    return {isFree, reason: busyBySensor ? "Live sensor shows occupied" : busyBySchedule ? "Scheduled class" : busyByBooking ? "Booked" : "Free"};
  }else{
    const isFree = !busyBySchedule && !busyByBooking;
    return {isFree, reason: busyBySchedule ? "Scheduled class" : busyByBooking ? "Booked" : "Free (by schedule)"};
  }
}

// ---- UI State ----
const state = {
  building: "",
  department: "",
  minCapacity: 0,
  when: new Date(),
  live: true,
  search: "",
};

// ---- Elements ----
const buildingSelect = $("#buildingSelect");
const departmentSelect = $("#departmentSelect");
const capacityInput = $("#capacityInput");
const timeInput = $("#timeInput");
const liveToggle = $("#liveToggle");
const searchInput = $("#searchInput");
const applyFiltersBtn = $("#applyFilters");
const roomList = $("#roomList");
const resultCount = $("#resultCount");
const resultTitle = $("#resultTitle");
const roomDialog = $("#roomDialog");
const roomDetails = $("#roomDetails");
const dialogTitle = $("#dialogTitle");
const bookBtn = $("#bookBtn");
const unbookBtn = $("#unbookBtn");
const loginBtn = $("#loginBtn");
const loginDialog = $("#loginDialog");
const roleSelect = $("#roleSelect");
const userIdInput = $("#userIdInput");
const loginConfirm = $("#loginConfirm");
const resetBtn = $("#resetBtn");
const toast = $("#toast");

// ---- Init ----
function init(){
  // Populate selects
  for (const b of new Set(DATA.rooms.map(r=>r.building))) {
    const opt=document.createElement('option'); opt.value=b; opt.textContent=b; buildingSelect.appendChild(opt);
  }
  for (const d of new Set(DATA.rooms.map(r=>r.department))) {
    const opt=document.createElement('option'); opt.value=d; opt.textContent=d; departmentSelect.appendChild(opt);
  }
  // Default time = now (local)
  timeInput.value = nowLocalISO();
  state.when = new Date();

  // Render initial list
  render();

  // Wire events
  buildingSelect.addEventListener('change', e => state.building = e.target.value);
  departmentSelect.addEventListener('change', e => state.department = e.target.value);
  capacityInput.addEventListener('input', e => state.minCapacity = Number(e.target.value || 0));
  timeInput.addEventListener('change', e => state.when = new Date(e.target.value));
  liveToggle.addEventListener('change', e => state.live = e.target.checked);
  searchInput.addEventListener('input', debounce(e => { state.search = e.target.value.trim().toLowerCase(); render(); }, 200));
  applyFiltersBtn.addEventListener('click', ()=>render());
  resetBtn.addEventListener('click', ()=>{ 
    state.building=""; state.department=""; state.minCapacity=0; state.live=true; state.search=""; state.when=new Date();
    buildingSelect.value=""; departmentSelect.value=""; capacityInput.value=""; liveToggle.checked=true; searchInput.value="";
    timeInput.value = nowLocalISO();
    bookings.clear();
    notify("Filters reset and all demo bookings cleared.");
    render();
  });

  loginBtn.addEventListener('click', ()=> loginDialog.showModal());
  loginConfirm.addEventListener('click', ()=> {
    const role = roleSelect.value; const uid = userIdInput.value.trim() || "GUEST";
    auth.user = {role, uid};
    loginDialog.close();
    notify(`Logged in as ${role.toUpperCase()} (${uid})`);
  });

  // Dialog booking actions
  bookBtn.addEventListener('click', onBook);
  unbookBtn.addEventListener('click', onUnbook);

  // Simulate sensor updates every 20s
  setInterval(simulateSensors, 20000);
}

document.addEventListener('DOMContentLoaded', init);

// ---- Rendering ----
function render(){
  const start = performance.now();

  const filtered = DATA.rooms.filter(room => {
    if (state.building && room.building !== state.building) return false;
    if (state.department && room.department !== state.department) return false;
    if (state.minCapacity && room.capacity < state.minCapacity) return false;
    if (state.search){
      const blob = `${room.name} ${room.building} ${room.department} ${room.equipment.join(" ")}`.toLowerCase();
      if (!blob.includes(state.search)) return false;
    }
    return true;
  });

  const cards = filtered.map(room => {
    const avail = availabilityFor(room, state.when, state.live);
    const b = bookings.get(room.id);
    const status = b ? "booked" : (avail.isFree ? "free" : "busy");
    const badge = status === "free" ? "badge-free" : status === "busy" ? "badge-busy" : "badge-booked";
    const statusText = status === "free" ? "Empty" : status === "busy" ? "Occupied" : "Booked";

    return `<li class="room-card" data-roomid="${room.id}">
      <div class="room-title">
        <strong>${room.name}</strong>
        <span class="badge ${badge}" title="${avail.reason}">${statusText}</span>
      </div>
      <div class="muted">${room.building} • Floor ${room.floor} • Dept: ${room.department}</div>
      <div>Capacity: <strong>${room.capacity}</strong></div>
      <div class="tags">${room.equipment.map(e=>`<span class="tag">${e}</span>`).join("")}</div>
      <div class="card-footer">
        <small class="muted">At: ${fmtTime(state.when)}</small>
        <button class="btn btn-secondary" onclick="openRoom('${room.id}')">Details</button>
      </div>
    </li>`;
  });

  roomList.innerHTML = cards.join("");
  resultCount.textContent = `${filtered.length} room${filtered.length!==1?'s':''}`;

  // Ensure under 2s for demo
  const elapsed = performance.now() - start;
  if (elapsed > 2000){
    console.warn("Search exceeded 2s in demo:", elapsed.toFixed(1), "ms");
  }
}

// ---- Room Modal ----
function openRoom(roomId){
  const room = DATA.rooms.find(r=>r.id===roomId);
  if (!room) return;
  const avail = availabilityFor(room, state.when, state.live);
  const booking = bookings.get(room.id);

  dialogTitle.textContent = room.name;
  roomDetails.innerHTML = `
    <div class="muted">${room.building} • Floor ${room.floor} • Dept: ${room.department}</div>
    <div><strong>Capacity:</strong> ${room.capacity}</div>
    <div><strong>Equipment:</strong> ${room.equipment.join(", ")}</div>
    <div><strong>Status:</strong> ${avail.isFree ? '<span class="badge badge-free">Empty</span>' : '<span class="badge badge-busy">Occupied</span>'} <small class="muted">(${avail.reason})</small></div>
    ${booking ? `<div><strong>Your Booking:</strong> ${fmtTime(booking.start)} → ${fmtTime(booking.end)}</div>` : ""}
    <label style="display:block; margin-top:8px">
      <span class="muted">Reserve (optional):</span>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:6px">
        <input id="bkStart" type="datetime-local" value="${nowLocalISO()}"/>
        <input id="bkEnd" type="datetime-local" value="${nowLocalISO()}"/>
      </div>
    </label>
  `;

  // Toggle buttons based on booking
  bookBtn.hidden = !!booking;
  unbookBtn.hidden = !booking;

  roomDialog.setAttribute('data-roomid', room.id);
  roomDialog.showModal();
}

function onBook(){
  const roomId = roomDialog.getAttribute('data-roomid');
  const start = $("#bkStart").value;
  const end = $("#bkEnd").value;
  if (!auth.user){
    notify("Please login to book.", true);
    return;
  }
  if (new Date(end) <= new Date(start)){
    notify("End time must be after start time.", true);
    return;
  }
  bookings.set(roomId, { by: auth.user.uid, role: auth.user.role, start, end });
  notify("Room booked successfully.");
  roomDialog.close();
  render();
}

function onUnbook(){
  const roomId = roomDialog.getAttribute('data-roomid');
  const existing = bookings.get(roomId);
  if (!existing){ roomDialog.close(); return; }
  // Only the same user or admin can cancel (demo rule)
  if (!auth.user || (auth.user.uid !== existing.by && auth.user.role !== "admin")){
    notify("You don't have permission to cancel this booking.", true);
    return;
  }
  bookings.remove(roomId);
  notify("Booking cancelled.");
  roomDialog.close();
  render();
}

// ---- Sensor Simulation ----
function simulateSensors(){
  // Randomly flip 5 rooms' sensor states for demo; trigger notifications if a watched room becomes free.
  const picks = [...DATA.rooms].sort(()=>Math.random()-0.5).slice(0,5);
  for (const r of picks){
    const prev = r.sensor;
    // 60% chance to remain the same, 40% toggle
    if (Math.random() < 0.4){
      r.sensor = (r.sensor === "occupied") ? "empty" : "occupied";
      // If it became free and matches current filters, notify
      const avail = availabilityFor(r, state.when, true);
      if (prev === "occupied" && r.sensor === "empty" && avail.isFree){
        notify(`${r.name} just became available.`);
      }
    }
  }
  // Re-render if live mode
  if (state.live) render();
}

// ---- Toasts ----
let toastTimer;
function notify(msg, isError=false){
  toast.textContent = msg;
  toast.style.borderColor = isError ? "rgba(239,68,68,.4)" : "var(--border)";
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> toast.hidden = true, 2600);
}

// Expose for inline handlers
window.openRoom = openRoom;
