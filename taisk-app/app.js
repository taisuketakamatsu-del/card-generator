(() => {
  "use strict";

  // "今日" is back, now driven by real due dates rather than being a
  // manual duplicate of いまやる: it's "due today", not "high priority".
  const BUCKETS = [
    { key: "today", label: "今日", dot: "dot-today" },
    { key: "week", label: "今週", dot: "dot-week" },
    { key: "month", label: "今月", dot: "dot-month" },
    { key: "later", label: "それ以降", dot: "dot-later" },
  ];

  // ---------------------------------------------------------------------
  // Due dates: if a task has one, its column is computed from the date
  // every time it renders (not fixed at creation), so it quietly slides
  // from 今月 into 今週 as the day approaches. Dragging to a column, or
  // editing without a date, falls back to the manually-picked bucket.
  // ---------------------------------------------------------------------
  const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function parseDueDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(`${dateStr}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  function computeBucketFromDate(dateStr) {
    const due = parseDueDate(dateStr);
    if (!due) return null;
    const today = startOfToday();
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    if (due <= today) return "today";
    if (due <= weekEnd) return "week";
    if (due <= monthEnd) return "month";
    return "later";
  }

  function effectiveBucket(task) {
    return (task.due_date && computeBucketFromDate(task.due_date)) || task.bucket || "week";
  }

  function formatDueBadge(dateStr) {
    const due = parseDueDate(dateStr);
    if (!due) return "";
    return `${due.getMonth() + 1}/${due.getDate()}(${WEEKDAY_JP[due.getDay()]})`;
  }

  // Pulls a leading "9/22" or "9/22(火)" off a pasted line (used by bulk
  // add) and turns it into a real due_date, assuming the nearest such
  // date that isn't more than ~2 months in the past.
  function extractLeadingDate(line) {
    const m = line.match(/^\s*(\d{1,2})\/(\d{1,2})(?:\([月火水木金土日]\))?[\s　:：、]*(.*)$/);
    if (!m) return { title: line, due_date: null };
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    const rest = m[3].trim();
    if (!rest || month < 1 || month > 12 || day < 1 || day > 31) return { title: line, due_date: null };
    const today = startOfToday();
    let year = today.getFullYear();
    let candidate = new Date(year, month - 1, day);
    const twoMonthsAgo = new Date(today);
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    if (candidate < twoMonthsAgo) candidate = new Date(year + 1, month - 1, day);
    const iso = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, "0")}-${String(candidate.getDate()).padStart(2, "0")}`;
    return { title: rest, due_date: iso };
  }

  const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---------------------------------------------------------------------
  // Backend detection: if config.js has real Supabase credentials, every
  // store talks to Supabase (shared realtime table + auth-gated private
  // table). Otherwise everything degrades to this-browser-only storage so
  // the app still works standalone.
  // ---------------------------------------------------------------------
  const CONFIG = window.TAISK_CONFIG || {};
  const REMOTE_ENABLED = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase);
  const sb = REMOTE_ENABLED ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;

  function nickToEmail(nickname) {
    // Supabase Auth wants an email-shaped identifier; nobody actually
    // receives mail here, it's just a stable per-nickname login id.
    return `taisk-${nickname.trim().toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿]/g, "") || "user"}-${nickname.length}@taisk.local`;
  }

  // ---------------------------------------------------------------------
  // Nickname (who is using the app right now)
  // ---------------------------------------------------------------------
  const NICK_KEY = "taisk.nickname";
  function getNickname() { return (localStorage.getItem(NICK_KEY) || "").trim(); }
  function setNickname(n) { localStorage.setItem(NICK_KEY, n.trim()); }
  let currentNickname = getNickname();

  const AVATAR_COLORS = ["#f43f5e", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];
  function colorForName(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function initialFor(name) {
    return (name || "?").trim().slice(0, 1).toUpperCase() || "?";
  }

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  const toast = document.getElementById("toast");
  let toastTimer = null;

  function showToast(message, actionLabel, actionFn) {
    clearTimeout(toastTimer);
    toast.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);
    if (actionLabel && actionFn) {
      const btn = document.createElement("button");
      btn.textContent = actionLabel;
      btn.style.cssText = "margin-left:12px;background:transparent;border:none;color:#a78bfa;font-weight:600;cursor:pointer;font-family:inherit;font-size:13.5px;";
      btn.addEventListener("click", () => {
        actionFn();
        toast.classList.remove("show");
      });
      toast.appendChild(btn);
    }
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 4000);
  }

  // ---------------------------------------------------------------------
  // Shared generic rendering (used for both the shared board and the
  // private board — same visuals, different data source).
  // ---------------------------------------------------------------------
  let openMenuId = null;
  function closeMenus() {
    openMenuId = null;
    document.querySelectorAll(".row-menu").forEach((m) => m.remove());
    document.querySelectorAll(".more-btn.menu-open").forEach((b) => b.classList.remove("menu-open"));
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".more-btn") && !e.target.closest(".row-menu")) closeMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenus();
  });

  // Purely visual now — the whole row is the tap target (see
  // attachTapToComplete), so this is a <span>, not an interactive button.
  function makeCheckIcon() {
    const el = document.createElement("span");
    el.className = "check-circle";
    el.innerHTML = CHECK_ICON;
    return el;
  }

  // Tapping anywhere on a row completes it — but not instantly: it shows
  // checked/struck-through first, and a second tap within the window
  // cancels the completion. Only after the window elapses does it actually
  // persist and disappear from the active list.
  function attachTapToComplete(row, task, store) {
    let pendingTimer = null;
    row.addEventListener("click", (e) => {
      if (e.target.closest(".more-btn") || e.target.closest(".row-menu")) return;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
        row.classList.remove("done");
        return;
      }
      row.classList.add("done");
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        store.toggleDone(task.id);
      }, 1300);
    });
  }

  function buildMenu(task, actions) {
    const menu = document.createElement("div");
    menu.className = "row-menu";

    const editBtn = document.createElement("button");
    editBtn.textContent = "編集";
    editBtn.addEventListener("click", (e2) => { e2.stopPropagation(); closeMenus(); actions.onEdit(); });

    const pinBtn = document.createElement("button");
    pinBtn.textContent = task.pinned ? "いまやるから外す" : "いまやるに追加";
    pinBtn.addEventListener("click", (e2) => { e2.stopPropagation(); closeMenus(); actions.onTogglePin(); });

    const delBtn = document.createElement("button");
    delBtn.textContent = "削除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", (e2) => { e2.stopPropagation(); closeMenus(); actions.onDelete(); });

    menu.appendChild(editBtn);
    menu.appendChild(pinBtn);
    menu.appendChild(delBtn);
    return menu;
  }

  function makeMoreBtn(task, actions) {
    const btn = document.createElement("button");
    btn.className = "more-btn";
    btn.textContent = "⋯";
    btn.title = "その他の操作(右クリックでも開けます)";
    btn.draggable = false;
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = openMenuId === task.id;
      closeMenus();
      if (isOpen) return;
      openMenuId = task.id;
      btn.classList.add("menu-open");
      btn.parentElement.appendChild(buildMenu(task, actions));
    });
    return btn;
  }

  // Right-click anywhere on a task row opens the same edit/pin/delete menu,
  // positioned at the cursor instead of anchored under the "..." button.
  function attachContextMenu(row, task, actions) {
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenus();
      openMenuId = task.id;
      const menu = buildMenu(task, actions);
      menu.style.position = "fixed";
      menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
      menu.style.top = `${Math.min(e.clientY, window.innerHeight - 140)}px`;
      menu.style.right = "auto";
      document.body.appendChild(menu);
    });
  }

  function renderNowList(store) {
    const pinned = store.tasks.filter((t) => t.pinned && !t.done).sort((a, b) => (a.priority || 0) - (b.priority || 0));
    store.els.nowCount.textContent = pinned.length;
    store.els.nowList.innerHTML = "";

    if (pinned.length === 0) {
      const empty = document.createElement("div");
      empty.className = "column-empty";
      empty.textContent = "いまやるタスクはありません。タスクの「⋯」から追加できます。";
      store.els.nowList.appendChild(empty);
      return;
    }

    // Only the top 3 get the big "spotlight" treatment; anything pinned
    // beyond that spills into a compact "最近" (recent) group below,
    // instead of growing いまやる without bound.
    const SPOTLIGHT_MAX = 3;

    pinned.forEach((task, i) => {
      if (i === SPOTLIGHT_MAX) {
        const label = document.createElement("div");
        label.className = "now-overflow-label";
        label.textContent = "最近";
        store.els.nowList.appendChild(label);
      }
      const isOverflow = i >= SPOTLIGHT_MAX;

      const row = document.createElement("div");
      row.className = "now-row" + (i === 0 ? " rank-1" : "") + (isOverflow ? " overflow" : "");
      row.dataset.id = task.id;
      row.draggable = true;
      // Priority is shown by both color intensity AND size — rank 1 is the
      // biggest, brightest row; each rank after that steps down on both.
      if (!isOverflow) {
        const opacity = Math.max(1 - i * 0.3, 0.28);
        const scale = Math.max(1 - i * 0.09, 0.78);
        row.style.setProperty("--rank-opacity", opacity.toFixed(2));
        row.style.setProperty("--rank-scale", scale.toFixed(2));
      }
      row.title = `優先度 ${i + 1}(ドラッグで並び替え・右クリックで編集/削除)`;

      row.addEventListener("dragstart", (e) => {
        row.classList.add("dragging");
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => row.classList.remove("dragging"));
      attachTapToComplete(row, task, store);

      const actions = {
        onEdit: () => store.openEdit(task.id),
        onTogglePin: () => store.togglePin(task.id),
        onDelete: () => store.deleteTask(task.id),
      };
      attachContextMenu(row, task, actions);

      row.appendChild(makeCheckIcon());
      const title = document.createElement("div");
      title.className = "task-title";
      title.textContent = task.title;
      row.appendChild(title);
      const dueBadge = makeDueBadge(task);
      if (dueBadge) row.appendChild(dueBadge);
      row.appendChild(makeMoreBtn(task, actions));
      store.els.nowList.appendChild(row);
    });
  }

  function makeDueBadge(task) {
    if (!task.due_date) return null;
    const badge = document.createElement("span");
    badge.className = "due-badge";
    badge.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg><span>${formatDueBadge(task.due_date)}</span>`;
    return badge;
  }

  function renderBoard(store) {
    store.els.board.innerHTML = "";
    BUCKETS.forEach((bucketDef) => {
      // Pinned tasks live only in いまやる — no duplicate showing in the
      // board too once they've been pulled into the spotlight.
      const items = store.tasks.filter((t) => effectiveBucket(t) === bucketDef.key && !t.done && !t.pinned);

      const col = document.createElement("div");
      col.className = "column";
      col.dataset.bucket = bucketDef.key;

      const header = document.createElement("div");
      header.className = "column-header";
      header.innerHTML = `<span class="dot ${bucketDef.dot}"></span><span class="column-title">${bucketDef.label}</span>`;
      const quickAdd = document.createElement("button");
      quickAdd.className = "col-add-btn";
      quickAdd.title = `${bucketDef.label}にタスクを追加`;
      quickAdd.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
      quickAdd.addEventListener("click", (e) => { e.stopPropagation(); store.openAdd(bucketDef.key); });
      header.appendChild(quickAdd);
      col.appendChild(header);

      const list = document.createElement("div");
      list.className = "column-list";

      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "column-empty";
        empty.textContent = "タスクなし";
        list.appendChild(empty);
      }

      items.forEach((task) => {
        const row = document.createElement("div");
        row.className = "task-row";
        row.draggable = true;
        row.dataset.id = task.id;

        row.addEventListener("dragstart", (e) => {
          row.classList.add("dragging");
          e.dataTransfer.setData("text/plain", task.id);
          e.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragend", () => row.classList.remove("dragging"));
        attachTapToComplete(row, task, store);

        const actions = {
          onEdit: () => store.openEdit(task.id),
          onTogglePin: () => store.togglePin(task.id),
          onDelete: () => store.deleteTask(task.id),
        };
        attachContextMenu(row, task, actions);

        row.appendChild(makeCheckIcon());
        const title = document.createElement("div");
        title.className = "task-title";
        title.textContent = task.title;
        row.appendChild(title);
        const dueBadge = makeDueBadge(task);
        if (dueBadge) row.appendChild(dueBadge);
        row.appendChild(makeMoreBtn(task, actions));
        list.appendChild(row);
      });

      col.appendChild(list);

      col.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; col.classList.add("drag-over"); });
      col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        col.classList.remove("drag-over");
        const id = e.dataTransfer.getData("text/plain");
        const task = store.tasks.find((t) => t.id === id);
        // A manual drag always wins: dropping it here fixes the bucket
        // explicitly, clears the date-driven auto-sort, and — if it came
        // from いまやる — unpins it so it actually shows up here instead
        // of staying in the spotlight only.
        if (task && (effectiveBucket(task) !== bucketDef.key || task.pinned)) {
          store.updateTask(id, { bucket: bucketDef.key, due_date: null, pinned: false });
        }
      });

      store.els.board.appendChild(col);
    });
  }

  function renderStore(store) {
    renderNowList(store);
    renderBoard(store);
  }

  // Figures out which now-row a dragged row should land before, based on
  // vertical cursor position — the standard "reorderable list" technique.
  function getDragAfterElement(container, y) {
    const rows = [...container.querySelectorAll(".now-row:not(.dragging)")];
    return rows.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  // いまやる accepts drops both to reorder pinned tasks (priority ranking)
  // and to pin a task dragged in from a board column.
  function setupNowListDnD(store) {
    const listEl = store.els.nowList;
    listEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const draggingEl = listEl.querySelector(".now-row.dragging");
      if (draggingEl) {
        const afterElement = getDragAfterElement(listEl, e.clientY);
        if (afterElement == null) listEl.appendChild(draggingEl);
        else listEl.insertBefore(draggingEl, afterElement);
      } else {
        listEl.classList.add("drag-over-now");
      }
    });
    listEl.addEventListener("dragleave", () => listEl.classList.remove("drag-over-now"));
    listEl.addEventListener("drop", (e) => {
      e.preventDefault();
      listEl.classList.remove("drag-over-now");
      const id = e.dataTransfer.getData("text/plain");
      const task = store.tasks.find((t) => t.id === id);
      if (!task) return;
      if (!task.pinned) {
        const maxPriority = Math.max(0, ...store.tasks.filter((t) => t.pinned).map((t) => t.priority || 0));
        store.updateTask(id, { pinned: true, priority: maxPriority + 1 });
        return;
      }
      const orderedIds = Array.from(listEl.querySelectorAll(".now-row[data-id]")).map((r) => r.dataset.id);
      orderedIds.forEach((tid, idx) => store.updateTask(tid, { priority: idx }));
    });
  }

  // ---------------------------------------------------------------------
  // Task store factory — one instance for "shared", one for "private".
  // Each knows how to load/insert/update/delete, either against Supabase
  // or a browser-local fallback, and exposes the same interface the
  // render functions above use.
  // ---------------------------------------------------------------------
  function createSeedTasks() {
    return [
      { id: uid(), title: "資料を提出する", bucket: "today", pinned: true, done: false, priority: 1, owner_name: currentNickname },
      { id: uid(), title: "メールを返信する", bucket: "today", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "会議の準備をする", bucket: "week", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "経費精算をする", bucket: "week", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "プロジェクト計画を見直す", bucket: "month", pinned: true, done: false, priority: 2, owner_name: currentNickname },
      { id: uid(), title: "チームミーティングを設定する", bucket: "month", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "レポートを作成する", bucket: "month", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "四半期目標を設定する", bucket: "month", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "研修に参加する", bucket: "later", pinned: true, done: false, priority: 3, owner_name: currentNickname },
      { id: uid(), title: "オフィス移転の計画", bucket: "later", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "システムのアップデート", bucket: "later", pinned: false, done: false, priority: 0, owner_name: currentNickname },
    ];
  }

  function loadLocal(key, seedFn) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { /* ignore corrupt storage */ }
    const seeded = seedFn ? seedFn() : [];
    saveLocal(key, seeded);
    return seeded;
  }
  function saveLocal(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
  }

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  function makeStore({ mode, table, localKey, seedFn, showOwner, els, afterRender }) {
    const store = {
      mode,
      tasks: [],
      showOwner,
      els,
      editingId: null,
      lastDeleted: null,
      channel: null,
      authClient: null, // set for the private store once logged in
      selectedBucket: "week",
    };

    store.render = () => { renderStore(store); if (afterRender) afterRender(); };
    setupNowListDnD(store);

    async function fetchRemote(client) {
      const { data, error } = await client.from(table).select("*").order("created_at", { ascending: true });
      if (error) { console.error(error); showToast("読み込みに失敗しました"); return; }
      store.tasks = data;
    }

    function persistLocal() { saveLocal(localKey, store.tasks); }

    store.purgeOldCompleted = async function () {
      const cutoff = Date.now() - THIRTY_DAYS_MS;
      const stale = store.tasks.filter((t) => t.done && t.completed_at && t.completed_at < cutoff);
      if (!stale.length) return;
      if (store.authClient) {
        await store.authClient.from(table).delete().in("id", stale.map((t) => t.id));
      } else {
        const staleIds = new Set(stale.map((t) => t.id));
        store.tasks = store.tasks.filter((t) => !staleIds.has(t.id));
        persistLocal();
      }
    };

    store.init = async function (client) {
      if (client) {
        store.authClient = client;
        await fetchRemote(client);
        store.channel = client
          .channel(`${table}-${mode}`)
          .on("postgres_changes", { event: "*", schema: "public", table }, async () => {
            await fetchRemote(client);
            store.render();
          })
          .subscribe();
      } else {
        store.tasks = loadLocal(localKey, seedFn);
      }
      await store.purgeOldCompleted();
      store.render();
    };

    store.teardown = function () {
      if (store.channel) { sb.removeChannel(store.channel); store.channel = null; }
    };

    store.addTask = async function ({ title, bucket, pinned, due_date }) {
      const priority = pinned ? Date.now() : 0;
      if (store.authClient) {
        const row = { title, bucket, pinned, due_date: due_date || null, done: false, priority };
        if (mode === "shared") row.owner_name = currentNickname;
        if (mode === "private") row.owner_id = (await store.authClient.auth.getUser()).data.user.id;
        const { error } = await store.authClient.from(table).insert(row);
        if (error) { console.error(error); showToast("追加に失敗しました"); }
        // realtime subscription will refresh + render
      } else {
        store.tasks.push({ id: uid(), title, bucket, pinned, due_date: due_date || null, done: false, priority, owner_name: currentNickname });
        persistLocal();
        store.render();
      }
    };

    store.updateTask = async function (id, patch) {
      if (patch.pinned === true && patch.priority === undefined) patch = { ...patch, priority: Date.now() };
      if (store.authClient) {
        const { error } = await store.authClient.from(table).update(patch).eq("id", id);
        if (error) { console.error(error); showToast("更新に失敗しました"); }
      } else {
        const t = store.tasks.find((x) => x.id === id);
        if (t) Object.assign(t, patch);
        persistLocal();
        store.render();
      }
    };

    store.togglePin = function (id) {
      const t = store.tasks.find((x) => x.id === id);
      if (!t) return;
      store.updateTask(id, { pinned: !t.pinned });
    };

    store.toggleDone = function (id) {
      store.updateTask(id, { done: true, completed_at: Date.now() });
    };

    store.restoreTask = function (id) {
      store.updateTask(id, { done: false, completed_at: null });
      showToast("未完了に戻しました");
    };

    store.deleteTask = async function (id) {
      const idx = store.tasks.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const removed = store.tasks[idx];
      if (store.authClient) {
        const { error } = await store.authClient.from(table).delete().eq("id", id);
        if (error) { console.error(error); showToast("削除に失敗しました"); return; }
        showToast("タスクを削除しました");
      } else {
        store.tasks.splice(idx, 1);
        persistLocal();
        store.render();
        showToast("タスクを削除しました", "元に戻す", () => {
          store.tasks.splice(Math.min(idx, store.tasks.length), 0, removed);
          persistLocal();
          store.render();
        });
      }
    };

    store.openEdit = function (id) { openTaskModal(store, id); };
    store.openAdd = function (bucketKey) { openTaskModal(store, null, bucketKey); };

    return store;
  }

  const sharedEls = {
    nowList: document.getElementById("nowList"),
    nowCount: document.getElementById("nowCount"),
    board: document.getElementById("board"),
  };
  const privateEls = {
    nowList: document.getElementById("nowListPriv"),
    nowCount: document.getElementById("nowCountPriv"),
    board: document.getElementById("boardPriv"),
  };

  const sharedStore = makeStore({
    mode: "shared",
    table: "tasks",
    localKey: "taisk.tasks.v1",
    seedFn: createSeedTasks,
    showOwner: true,
    els: sharedEls,
    afterRender: () => renderCompleted(),
  });
  const privateStore = makeStore({
    mode: "private",
    table: "private_tasks",
    localKey: `taisk.private.tasks.${currentNickname}`,
    seedFn: () => [],
    showOwner: false,
    els: privateEls,
    afterRender: () => renderCompletedPriv(),
  });

  // ---------------------------------------------------------------------
  // Add / edit task modal (shared by both stores)
  // ---------------------------------------------------------------------
  const modalOverlay = document.getElementById("modalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const taskTitleLabel = document.getElementById("taskTitleLabel");
  const taskTitleInput = document.getElementById("taskTitleInput");
  const taskBulkInput = document.getElementById("taskBulkInput");
  const bulkModeToggle = document.getElementById("bulkModeToggle");
  const taskDueDateInput = document.getElementById("taskDueDateInput");
  const bucketPicker = document.getElementById("bucketPicker");
  const pinCheckbox = document.getElementById("pinCheckbox");
  const saveBtn = document.getElementById("saveBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const addBtn = document.getElementById("addBtn");
  const shareBtn = document.getElementById("shareBtn");

  let activeStore = sharedStore;
  let modalEditingId = null;
  let bulkMode = false;

  function setBulkMode(on) {
    bulkMode = on;
    taskTitleInput.style.display = on ? "none" : "block";
    taskBulkInput.style.display = on ? "block" : "none";
    taskTitleLabel.textContent = on ? "タスク名(1行に1つ)" : "タスク名";
    saveBtn.textContent = on ? "まとめて追加" : "追加";
    if (on) { taskBulkInput.value = ""; setTimeout(() => taskBulkInput.focus(), 30); }
  }
  bulkModeToggle.addEventListener("click", () => setBulkMode(!bulkMode));

  function setSelectedBucket(store, bucketKey) {
    store.selectedBucket = bucketKey;
    bucketPicker.querySelectorAll(".bucket-opt").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.bucket === bucketKey);
    });
  }
  bucketPicker.querySelectorAll(".bucket-opt").forEach((btn) => {
    btn.addEventListener("click", () => setSelectedBucket(activeStore, btn.dataset.bucket));
  });

  // Picking a date previews which bucket it'll actually land in, since
  // the date (when present) always wins over the manual bucket choice.
  taskDueDateInput.addEventListener("change", () => {
    const computed = computeBucketFromDate(taskDueDateInput.value);
    if (computed) setSelectedBucket(activeStore, computed);
  });

  function openTaskModal(store, id, presetBucket) {
    activeStore = store;
    modalEditingId = id || null;
    setBulkMode(false);
    bulkModeToggle.style.display = id ? "none" : "inline-block";
    if (id) {
      const task = store.tasks.find((t) => t.id === id);
      if (!task) return;
      modalTitle.textContent = "タスクを編集";
      taskTitleInput.value = task.title;
      taskDueDateInput.value = task.due_date || "";
      pinCheckbox.checked = !!task.pinned;
      deleteBtn.style.display = "inline-block";
      saveBtn.textContent = "保存";
      setSelectedBucket(store, effectiveBucket(task));
    } else {
      modalTitle.textContent = "新しいタスク";
      taskTitleInput.value = "";
      taskDueDateInput.value = "";
      pinCheckbox.checked = false;
      deleteBtn.style.display = "none";
      saveBtn.textContent = "追加";
      setSelectedBucket(store, presetBucket || "today");
    }
    modalOverlay.classList.add("open");
    setTimeout(() => taskTitleInput.focus(), 30);
  }

  function closeTaskModal() {
    modalOverlay.classList.remove("open");
    modalEditingId = null;
  }

  function saveTaskModal() {
    if (bulkMode && !modalEditingId) {
      const lines = taskBulkInput.value.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) { taskBulkInput.focus(); return; }
      // Each line may start with its own "9/22" or "9/22(火)" date — when
      // present, it decides the bucket; lines without one fall back to
      // whatever bucket is currently selected in the picker.
      lines.forEach((line) => {
        const { title, due_date } = extractLeadingDate(line);
        activeStore.addTask({
          title,
          bucket: due_date ? computeBucketFromDate(due_date) : activeStore.selectedBucket,
          due_date,
          pinned: pinCheckbox.checked,
        });
      });
      showToast(`${lines.length}件のタスクを追加しました`);
      closeTaskModal();
      return;
    }
    const title = taskTitleInput.value.trim();
    if (!title) { taskTitleInput.focus(); return; }
    const due_date = taskDueDateInput.value || null;
    const payload = {
      title,
      bucket: due_date ? computeBucketFromDate(due_date) : activeStore.selectedBucket,
      due_date,
      pinned: pinCheckbox.checked,
    };
    if (modalEditingId) {
      activeStore.updateTask(modalEditingId, payload);
    } else {
      activeStore.addTask(payload);
    }
    closeTaskModal();
  }

  cancelBtn.addEventListener("click", closeTaskModal);
  saveBtn.addEventListener("click", saveTaskModal);
  deleteBtn.addEventListener("click", () => {
    if (modalEditingId) {
      const id = modalEditingId;
      closeTaskModal();
      activeStore.deleteTask(id);
    }
  });
  taskTitleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveTaskModal(); });
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeTaskModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modalOverlay.classList.contains("open")) closeTaskModal();
    if (shareOverlay.classList.contains("open")) closeShareModal();
  });

  addBtn.addEventListener("click", () => {
    if (currentTab === "private" && !privateUnlocked) {
      showToast("先にプライベートにログインしてください");
      return;
    }
    openTaskModal(currentTab === "private" ? privateStore : sharedStore, null);
  });

  // ---------------------------------------------------------------------
  // Share: show the link to this board (same URL = same shared tasks
  // once Supabase is configured; in local-only mode it just shares this
  // page, useful once it's hosted somewhere).
  // ---------------------------------------------------------------------
  const shareOverlay = document.getElementById("shareOverlay");
  const shareLinkInput = document.getElementById("shareLinkInput");
  const shareCopyBtn = document.getElementById("shareCopyBtn");
  const shareCloseBtn = document.getElementById("shareCloseBtn");

  function openShareModal() {
    shareLinkInput.value = window.location.href.split("#")[0];
    shareOverlay.classList.add("open");
    setTimeout(() => shareLinkInput.select(), 30);
  }
  function closeShareModal() { shareOverlay.classList.remove("open"); }

  shareBtn.addEventListener("click", openShareModal);
  shareCloseBtn.addEventListener("click", closeShareModal);
  shareOverlay.addEventListener("click", (e) => { if (e.target === shareOverlay) closeShareModal(); });
  shareCopyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(shareLinkInput.value); showToast("リンクをコピーしました"); }
    catch (e) { shareLinkInput.select(); showToast("選択したので Cmd/Ctrl+C でコピーしてください"); }
  });

  // ---------------------------------------------------------------------
  // Nickname registration
  // ---------------------------------------------------------------------
  const nicknameOverlay = document.getElementById("nicknameOverlay");
  const nicknameInput = document.getElementById("nicknameInput");
  const nicknameSaveBtn = document.getElementById("nicknameSaveBtn");

  function openNicknameModal() {
    nicknameInput.value = currentNickname;
    nicknameOverlay.classList.add("open");
    setTimeout(() => nicknameInput.focus(), 30);
  }

  async function confirmNickname() {
    const name = nicknameInput.value.trim();
    if (!name) { nicknameInput.focus(); return; }
    const changed = name !== currentNickname;
    currentNickname = name;
    setNickname(name);
    nicknameOverlay.classList.remove("open");
    if (changed) {
      privateStore.localKey = `taisk.private.tasks.${currentNickname}`;
      privateUnlocked = false;
      if (privateStore.channel) privateStore.teardown();
      showPrivateLocked();
      setupPresence();
    }
  }

  nicknameSaveBtn.addEventListener("click", confirmNickname);
  nicknameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmNickname(); });

  // ---------------------------------------------------------------------
  // Completed tasks archive (kept 30 days, restorable). 仕事 and
  // プライベート each get their own — never mixed together.
  // ---------------------------------------------------------------------
  function renderCompletedInto(store, listEl, countEl) {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const items = store.tasks
      .filter((t) => t.done && (!t.completed_at || t.completed_at >= cutoff))
      .sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0));

    countEl.textContent = items.length;
    listEl.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "column-empty";
      empty.textContent = "完了したタスクはまだありません。";
      listEl.appendChild(empty);
      return;
    }

    items.forEach((task) => {
      const row = document.createElement("div");
      row.className = "completed-row";

      const check = document.createElement("button");
      check.className = "check-circle checked";
      check.innerHTML = CHECK_ICON;
      check.title = "未完了に戻す";
      check.addEventListener("click", () => store.restoreTask(task.id));
      row.appendChild(check);

      const title = document.createElement("div");
      title.className = "task-title";
      title.textContent = task.title;
      row.appendChild(title);

      const restoreBtn = document.createElement("button");
      restoreBtn.className = "btn-ghost restore-btn";
      restoreBtn.textContent = "復元";
      restoreBtn.addEventListener("click", () => store.restoreTask(task.id));
      row.appendChild(restoreBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "more-btn always-visible";
      delBtn.textContent = "✕";
      delBtn.title = "完全に削除";
      delBtn.addEventListener("click", () => store.deleteTask(task.id));
      row.appendChild(delBtn);

      listEl.appendChild(row);
    });
  }

  const completedList = document.getElementById("completedList");
  const completedCount = document.getElementById("completedCount");
  function renderCompleted() { renderCompletedInto(sharedStore, completedList, completedCount); }

  const completedListPriv = document.getElementById("completedListPriv");
  const completedCountPriv = document.getElementById("completedCountPriv");
  function renderCompletedPriv() { renderCompletedInto(privateStore, completedListPriv, completedCountPriv); }

  // プライベート's own mini tab strip (タスク / 完了済み), independent of
  // the outer 仕事/完了済み tabs.
  const privateSubTabBar = document.getElementById("privateSubTabBar");
  const privateBoardWrap = document.getElementById("privateBoardWrap");
  const privateCompletedWrap = document.getElementById("privateCompletedWrap");
  privateSubTabBar.querySelectorAll(".sub-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = btn.dataset.subtab;
      privateSubTabBar.querySelectorAll(".sub-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      privateBoardWrap.classList.toggle("active", sub === "board");
      privateCompletedWrap.classList.toggle("active", sub === "completed");
      if (sub === "completed") renderCompletedPriv();
    });
  });

  // ---------------------------------------------------------------------
  // Tabs: shared / 完了済み / private
  // ---------------------------------------------------------------------
  const tabBar = document.getElementById("tabBar");
  const privateToggleBtn = document.getElementById("privateToggleBtn");
  const privateToggleLabel = document.getElementById("privateToggleLabel");
  const iconLock = privateToggleBtn.querySelector(".icon-lock");
  const iconBack = privateToggleBtn.querySelector(".icon-back");
  const sharedView = document.getElementById("sharedView");
  const completedView = document.getElementById("completedView");
  const privateView = document.getElementById("privateView");
  let currentTab = "shared";
  let lastWorkTab = "shared"; // remembers which work tab to return to

  tabBar.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });
  // One button does both jobs: "プライベートへ" from work, "仕事に戻る" from
  // private — a single swap instead of a third equal-weight tab, so
  // entering/leaving private reads as switching to a different place
  // entirely rather than picking another tab.
  privateToggleBtn.addEventListener("click", () => setTab(currentTab === "private" ? lastWorkTab : "private"));

  // Two extra, always-available ways back from private, in case the small
  // toggle button is ever missed: the logo, and the Escape key.
  const logoEl = document.querySelector(".logo");
  if (logoEl) {
    logoEl.style.cursor = "pointer";
    logoEl.addEventListener("click", () => { if (currentTab === "private") setTab(lastWorkTab); });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || currentTab !== "private") return;
    if (modalOverlay.classList.contains("open") || shareOverlay.classList.contains("open") || nicknameOverlay.classList.contains("open")) return;
    setTab(lastWorkTab);
  });

  function setTab(tab) {
    // プライベート is deliberately separate from the 仕事/完了済み pair —
    // leaving it always re-locks it, so the passcode is asked again every
    // time, not just once per page load.
    if (currentTab === "private" && tab !== "private") lockPrivate();
    if (tab !== "private") lastWorkTab = tab;

    currentTab = tab;
    tabBar.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    sharedView.classList.toggle("active", tab === "shared");
    completedView.classList.toggle("active", tab === "completed");
    privateView.classList.toggle("active", tab === "private");
    document.body.classList.toggle("tab-private", tab === "private");

    const inPrivate = tab === "private";
    privateToggleLabel.textContent = inPrivate ? "仕事に戻る" : "プライベート";
    privateToggleBtn.title = inPrivate ? "仕事に戻る" : "プライベート";
    iconLock.style.display = inPrivate ? "none" : "block";
    iconBack.style.display = inPrivate ? "block" : "none";
    privateToggleBtn.classList.toggle("active", inPrivate);

    if (tab === "completed") renderCompleted();
    if (tab === "private" && !privateUnlocked) setTimeout(() => privatePasswordInput.focus(), 30);
  }

  // ---------------------------------------------------------------------
  // Private login (real Supabase Auth when remote, hashed-password
  // fallback stored in this browser when running standalone).
  // ---------------------------------------------------------------------
  const privateLocked = document.getElementById("privateLocked");
  const privateContent = document.getElementById("privateContent");
  const privatePasswordInput = document.getElementById("privatePasswordInput");
  const privateUnlockBtn = document.getElementById("privateUnlockBtn");
  const privateResetBtn = document.getElementById("privateResetBtn");
  const privateError = document.getElementById("privateError");

  let privateUnlocked = false;

  function localPassKey() { return `taisk.private.pass.${currentNickname}`; }

  function showPrivateLocked() {
    privateLocked.style.display = "flex";
    privateContent.style.display = "none";
    privatePasswordInput.value = "";
    privateError.textContent = "";
    if (currentTab === "private") setTimeout(() => privatePasswordInput.focus(), 30);
  }

  async function showPrivateContent() {
    privateLocked.style.display = "none";
    privateContent.style.display = "flex";
    privateUnlocked = true;
    // Always land on the task board, not wherever the sub-tab was left.
    privateSubTabBar.querySelectorAll(".sub-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.subtab === "board"));
    privateBoardWrap.classList.add("active");
    privateCompletedWrap.classList.remove("active");
    await privateStore.init(REMOTE_ENABLED ? sb : null);
  }

  // プライベート asks for the passcode every time you enter it — leaving
  // (or reloading) re-locks it rather than remembering the device.
  function lockPrivate() {
    privateUnlocked = false;
    if (privateStore.channel) privateStore.teardown();
    if (REMOTE_ENABLED) sb.auth.signOut();
    showPrivateLocked();
  }

  // First password typed for a nickname becomes its passcode automatically
  // — no separate "sign up" step to think about.
  privateUnlockBtn.addEventListener("click", async () => {
    if (!currentNickname) { showToast("先にニックネームを登録してください"); openNicknameModal(); return; }
    const pw = privatePasswordInput.value;
    if (!pw || pw.length < 2) { privateError.textContent = "2文字以上のパスコードを入力してください"; return; }

    if (REMOTE_ENABLED) {
      const email = nickToEmail(currentNickname);
      let { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) {
        const signup = await sb.auth.signUp({ email, password: pw });
        if (signup.error) { privateError.textContent = "開けませんでした: " + signup.error.message; return; }
      }
      await showPrivateContent();
    } else {
      const stored = localStorage.getItem(localPassKey());
      const hash = await sha256Hex(pw);
      if (!stored) {
        localStorage.setItem(localPassKey(), hash);
      } else if (stored !== hash) {
        privateError.textContent = "パスコードが違います";
        return;
      }
      await showPrivateContent();
    }
  });
  privatePasswordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") privateUnlockBtn.click(); });

  // Local-only mode has no real recovery flow — resetting just forgets the
  // stored passcode hash so the next entry becomes the new one. Private
  // tasks themselves are untouched (different storage key).
  if (REMOTE_ENABLED) {
    privateResetBtn.style.display = "none";
  } else {
    privateResetBtn.addEventListener("click", () => {
      if (!currentNickname) return;
      localStorage.removeItem(localPassKey());
      privateError.textContent = "";
      showToast("パスコードをリセットしました。次に入力した内容が新しいパスコードになります");
      privatePasswordInput.focus();
    });
  }

  // ---------------------------------------------------------------------
  // Presence ("who is viewing now", Google Slides style avatar stack)
  // ---------------------------------------------------------------------
  const presenceStack = document.getElementById("presenceStack");

  function renderPresence(names) {
    presenceStack.innerHTML = "";
    let unique = Array.from(new Set(names));
    if (currentNickname && !unique.includes(currentNickname)) unique = [currentNickname, ...unique];
    unique.slice(0, 6).forEach((name) => {
      const isSelf = name === currentNickname;
      const av = document.createElement("span");
      av.className = "presence-avatar" + (isSelf ? " is-self" : "");
      av.style.background = colorForName(name);
      av.textContent = initialFor(name);
      av.title = isSelf ? `${name}(クリックしてニックネームを変更)` : name;
      if (isSelf) av.addEventListener("click", () => openNicknameModal());
      presenceStack.appendChild(av);
    });
  }

  let presenceChannel = null;
  function setupPresence() {
    if (presenceChannel) { sb.removeChannel(presenceChannel); presenceChannel = null; }
    if (!REMOTE_ENABLED || !currentNickname) {
      renderPresence(currentNickname ? [currentNickname] : []);
      return;
    }
    presenceChannel = sb.channel("taisk-presence", { config: { presence: { key: currentNickname } } });
    presenceChannel.on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      renderPresence(Object.values(state).flat().map((p) => p.name));
    });
    presenceChannel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") await presenceChannel.track({ name: currentNickname, at: Date.now() });
    });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  async function bootstrap() {
    if (!currentNickname) {
      nicknameOverlay.classList.add("open");
      setTimeout(() => nicknameInput.focus(), 30);
    }
    await sharedStore.init(REMOTE_ENABLED ? sb : null);
    // Always start プライベート locked — no remembered session across
    // reloads, even when Supabase Auth would otherwise keep one alive.
    if (REMOTE_ENABLED) await sb.auth.signOut();
    showPrivateLocked();
    setupPresence();
  }

  bootstrap();
})();
