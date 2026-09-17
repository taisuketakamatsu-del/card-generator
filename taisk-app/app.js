(() => {
  "use strict";

  const BUCKETS = [
    { key: "today", label: "今日", dot: "dot-today" },
    { key: "week", label: "今週", dot: "dot-week" },
    { key: "month", label: "今月", dot: "dot-month" },
    { key: "later", label: "それ以降", dot: "dot-later" },
  ];

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

  function makeCheckCircle(onCheck) {
    const btn = document.createElement("button");
    btn.className = "check-circle";
    btn.innerHTML = CHECK_ICON;
    btn.title = "完了にする";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onCheck();
    });
    return btn;
  }

  function makeMoreBtn(task, actions) {
    const btn = document.createElement("button");
    btn.className = "more-btn";
    btn.textContent = "⋯";
    btn.title = "その他の操作";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = openMenuId === task.id;
      closeMenus();
      if (isOpen) return;
      openMenuId = task.id;
      btn.classList.add("menu-open");

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
      btn.parentElement.appendChild(menu);
    });
    return btn;
  }

  function ownerBadge(name) {
    if (!name) return null;
    const b = document.createElement("span");
    b.className = "owner-badge";
    b.style.background = colorForName(name);
    b.textContent = initialFor(name);
    b.title = name;
    return b;
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

    pinned.forEach((task, i) => {
      const row = document.createElement("div");
      row.className = "now-row" + (i === 0 ? " rank-1" : "");
      const opacity = Math.max(1 - i * 0.3, 0.28);
      row.style.setProperty("--rank-opacity", opacity.toFixed(2));
      row.title = `優先度 ${i + 1}`;
      row.addEventListener("click", () => store.openEdit(task.id));

      row.appendChild(makeCheckCircle(() => store.toggleDone(task.id, row)));
      const title = document.createElement("div");
      title.className = "task-title";
      title.textContent = task.title;
      row.appendChild(title);
      if (store.showOwner) {
        const badge = ownerBadge(task.owner_name);
        if (badge) row.appendChild(badge);
      }
      row.appendChild(makeMoreBtn(task, {
        onEdit: () => store.openEdit(task.id),
        onTogglePin: () => store.togglePin(task.id),
        onDelete: () => store.deleteTask(task.id),
      }));
      store.els.nowList.appendChild(row);
    });
  }

  function renderBoard(store) {
    store.els.board.innerHTML = "";
    BUCKETS.forEach((bucketDef) => {
      const items = store.tasks.filter((t) => t.bucket === bucketDef.key && !t.done);

      const col = document.createElement("div");
      col.className = "column";
      col.dataset.bucket = bucketDef.key;

      const header = document.createElement("div");
      header.className = "column-header";
      header.innerHTML = `<span class="dot ${bucketDef.dot}"></span><span class="column-title">${bucketDef.label}</span>`;
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = items.length;
      header.appendChild(badge);
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
        row.addEventListener("click", () => store.openEdit(task.id));

        row.appendChild(makeCheckCircle(() => store.toggleDone(task.id, row)));
        const title = document.createElement("div");
        title.className = "task-title";
        title.textContent = task.title;
        row.appendChild(title);
        if (store.showOwner) {
          const badge = ownerBadge(task.owner_name);
          if (badge) row.appendChild(badge);
        }
        row.appendChild(makeMoreBtn(task, {
          onEdit: () => store.openEdit(task.id),
          onTogglePin: () => store.togglePin(task.id),
          onDelete: () => store.deleteTask(task.id),
        }));
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
        if (task && task.bucket !== bucketDef.key) store.updateTask(id, { bucket: bucketDef.key });
      });

      store.els.board.appendChild(col);
    });
  }

  function renderStore(store) {
    renderNowList(store);
    renderBoard(store);
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
      { id: uid(), title: "会議の準備をする", bucket: "today", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "経費精算をする", bucket: "today", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "プロジェクト計画を見直す", bucket: "week", pinned: true, done: false, priority: 2, owner_name: currentNickname },
      { id: uid(), title: "チームミーティングを設定する", bucket: "week", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "レポートを作成する", bucket: "week", pinned: false, done: false, priority: 0, owner_name: currentNickname },
      { id: uid(), title: "四半期目標を設定する", bucket: "month", pinned: true, done: false, priority: 3, owner_name: currentNickname },
      { id: uid(), title: "研修に参加する", bucket: "month", pinned: false, done: false, priority: 0, owner_name: currentNickname },
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

  function makeStore({ mode, table, localKey, seedFn, showOwner, els }) {
    const store = {
      mode,
      tasks: [],
      showOwner,
      els,
      editingId: null,
      lastDeleted: null,
      channel: null,
      authClient: null, // set for the private store once logged in
      selectedBucket: "today",
    };

    store.render = () => renderStore(store);

    async function fetchRemote(client) {
      const { data, error } = await client.from(table).select("*").order("created_at", { ascending: true });
      if (error) { console.error(error); showToast("読み込みに失敗しました"); return; }
      store.tasks = data;
    }

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
      store.render();
    };

    store.teardown = function () {
      if (store.channel) { sb.removeChannel(store.channel); store.channel = null; }
    };

    function persistLocal() { saveLocal(localKey, store.tasks); }

    store.addTask = async function ({ title, bucket, pinned }) {
      const priority = pinned ? Date.now() : 0;
      if (store.authClient) {
        const row = { title, bucket, pinned, done: false, priority };
        if (mode === "shared") row.owner_name = currentNickname;
        if (mode === "private") row.owner_id = (await store.authClient.auth.getUser()).data.user.id;
        const { error } = await store.authClient.from(table).insert(row);
        if (error) { console.error(error); showToast("追加に失敗しました"); }
        // realtime subscription will refresh + render
      } else {
        store.tasks.push({ id: uid(), title, bucket, pinned, done: false, priority, owner_name: currentNickname });
        persistLocal();
        store.render();
      }
    };

    store.updateTask = async function (id, patch) {
      if (patch.pinned === true) patch = { ...patch, priority: Date.now() };
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

    store.toggleDone = function (id, rowEl) {
      store.updateTask(id, { done: true });
      if (rowEl) {
        rowEl.classList.add("done");
        if (!store.authClient) setTimeout(() => store.render(), 260);
      }
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
  });
  const privateStore = makeStore({
    mode: "private",
    table: "private_tasks",
    localKey: `taisk.private.tasks.${currentNickname}`,
    seedFn: () => [],
    showOwner: false,
    els: privateEls,
  });

  // ---------------------------------------------------------------------
  // Add / edit task modal (shared by both stores)
  // ---------------------------------------------------------------------
  const modalOverlay = document.getElementById("modalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const taskTitleInput = document.getElementById("taskTitleInput");
  const bucketPicker = document.getElementById("bucketPicker");
  const pinCheckbox = document.getElementById("pinCheckbox");
  const saveBtn = document.getElementById("saveBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const addBtn = document.getElementById("addBtn");
  const shareBtn = document.getElementById("shareBtn");

  let activeStore = sharedStore;
  let modalEditingId = null;

  function setSelectedBucket(store, bucketKey) {
    store.selectedBucket = bucketKey;
    bucketPicker.querySelectorAll(".bucket-opt").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.bucket === bucketKey);
    });
  }
  bucketPicker.querySelectorAll(".bucket-opt").forEach((btn) => {
    btn.addEventListener("click", () => setSelectedBucket(activeStore, btn.dataset.bucket));
  });

  function openTaskModal(store, id) {
    activeStore = store;
    modalEditingId = id || null;
    if (id) {
      const task = store.tasks.find((t) => t.id === id);
      if (!task) return;
      modalTitle.textContent = "タスクを編集";
      taskTitleInput.value = task.title;
      pinCheckbox.checked = !!task.pinned;
      deleteBtn.style.display = "inline-block";
      saveBtn.textContent = "保存";
      setSelectedBucket(store, task.bucket);
    } else {
      modalTitle.textContent = "新しいタスク";
      taskTitleInput.value = "";
      pinCheckbox.checked = false;
      deleteBtn.style.display = "none";
      saveBtn.textContent = "追加";
      setSelectedBucket(store, "today");
    }
    modalOverlay.classList.add("open");
    setTimeout(() => taskTitleInput.focus(), 30);
  }

  function closeTaskModal() {
    modalOverlay.classList.remove("open");
    modalEditingId = null;
  }

  function saveTaskModal() {
    const title = taskTitleInput.value.trim();
    if (!title) { taskTitleInput.focus(); return; }
    const payload = { title, bucket: activeStore.selectedBucket, pinned: pinCheckbox.checked };
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
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modalOverlay.classList.contains("open")) closeTaskModal(); });

  addBtn.addEventListener("click", () => {
    if (currentTab === "private" && !privateUnlocked) {
      showToast("先にプライベートにログインしてください");
      return;
    }
    openTaskModal(currentTab === "private" ? privateStore : sharedStore, null);
  });

  // ---------------------------------------------------------------------
  // Share (Web Share API / clipboard) — shared board only
  // ---------------------------------------------------------------------
  function buildShareText() {
    const active = sharedStore.tasks.filter((t) => !t.done);
    const lines = ["【taisk】タスク一覧", ""];
    const pinned = active.filter((t) => t.pinned).sort((a, b) => (a.priority || 0) - (b.priority || 0));
    if (pinned.length) {
      lines.push("■ いまやる");
      pinned.forEach((t) => lines.push(`- ${t.title}${t.owner_name ? `(${t.owner_name})` : ""}`));
      lines.push("");
    }
    BUCKETS.forEach((b) => {
      const items = active.filter((t) => t.bucket === b.key);
      if (!items.length) return;
      lines.push(`■ ${b.label}`);
      items.forEach((t) => lines.push(`- ${t.title}${t.owner_name ? `(${t.owner_name})` : ""}`));
      lines.push("");
    });
    return lines.join("\n").trim();
  }

  async function shareTasks() {
    const text = buildShareText();
    if (navigator.share) {
      try { await navigator.share({ title: "taisk タスク一覧", text }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(text); showToast("タスク一覧をクリップボードにコピーしました"); }
    catch (e) { showToast("コピーに失敗しました。ブラウザの権限をご確認ください"); }
  }
  shareBtn.addEventListener("click", shareTasks);

  // ---------------------------------------------------------------------
  // Nickname registration
  // ---------------------------------------------------------------------
  const nicknameOverlay = document.getElementById("nicknameOverlay");
  const nicknameInput = document.getElementById("nicknameInput");
  const nicknameSaveBtn = document.getElementById("nicknameSaveBtn");
  const whoamiBtn = document.getElementById("whoamiBtn");

  function updateWhoami() {
    whoamiBtn.textContent = currentNickname ? `${currentNickname} として利用中(変更)` : "ニックネーム未設定";
  }

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
    updateWhoami();
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
  whoamiBtn.addEventListener("click", openNicknameModal);

  // ---------------------------------------------------------------------
  // Tabs: shared <-> private
  // ---------------------------------------------------------------------
  const tabBar = document.getElementById("tabBar");
  const sharedView = document.getElementById("sharedView");
  const privateView = document.getElementById("privateView");
  let currentTab = "shared";

  tabBar.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  function setTab(tab) {
    currentTab = tab;
    tabBar.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    sharedView.classList.toggle("active", tab === "shared");
    privateView.classList.toggle("active", tab === "private");
    document.body.classList.toggle("tab-private", tab === "private");
  }

  // ---------------------------------------------------------------------
  // Private login (real Supabase Auth when remote, hashed-password
  // fallback stored in this browser when running standalone).
  // ---------------------------------------------------------------------
  const privateLocked = document.getElementById("privateLocked");
  const privateContent = document.getElementById("privateContent");
  const privatePasswordInput = document.getElementById("privatePasswordInput");
  const privatePasswordConfirm = document.getElementById("privatePasswordConfirm");
  const privateUnlockBtn = document.getElementById("privateUnlockBtn");
  const privateModeToggle = document.getElementById("privateModeToggle");
  const privateError = document.getElementById("privateError");

  let privateUnlocked = false;
  let privateSignupMode = false;

  function localPassKey() { return `taisk.private.pass.${currentNickname}`; }

  function setPrivateSignupMode(on) {
    privateSignupMode = on;
    privatePasswordConfirm.style.display = on ? "block" : "none";
    privateUnlockBtn.textContent = on ? "登録する" : "ログイン";
    privateModeToggle.textContent = on ? "ログインに戻る" : "はじめての方はこちら(登録)";
    privateError.textContent = "";
  }

  function showPrivateLocked() {
    privateLocked.style.display = "flex";
    privateContent.style.display = "none";
    privatePasswordInput.value = "";
    privatePasswordConfirm.value = "";
    privateError.textContent = "";
    if (!REMOTE_ENABLED) {
      const hasLocalAccount = !!localStorage.getItem(localPassKey());
      setPrivateSignupMode(!hasLocalAccount);
    } else {
      setPrivateSignupMode(false);
    }
  }

  async function showPrivateContent() {
    privateLocked.style.display = "none";
    privateContent.style.display = "flex";
    privateUnlocked = true;
    await privateStore.init(REMOTE_ENABLED ? sb : null);
  }

  privateModeToggle.addEventListener("click", () => setPrivateSignupMode(!privateSignupMode));

  privateUnlockBtn.addEventListener("click", async () => {
    if (!currentNickname) { showToast("先にニックネームを登録してください"); openNicknameModal(); return; }
    const pw = privatePasswordInput.value;
    if (!pw || pw.length < 4) { privateError.textContent = "パスワードは4文字以上にしてください"; return; }

    if (REMOTE_ENABLED) {
      const email = nickToEmail(currentNickname);
      if (privateSignupMode) {
        const { error } = await sb.auth.signUp({ email, password: pw });
        if (error) { privateError.textContent = "登録に失敗しました: " + error.message; return; }
        showToast("プライベートアカウントを作成しました");
        await showPrivateContent();
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) { privateError.textContent = "パスワードが違います"; return; }
        await showPrivateContent();
      }
    } else {
      if (privateSignupMode) {
        if (pw !== privatePasswordConfirm.value) { privateError.textContent = "確認用パスワードが一致しません"; return; }
        localStorage.setItem(localPassKey(), await sha256Hex(pw));
        showToast("このブラウザ用にプライベートを設定しました");
        await showPrivateContent();
      } else {
        const stored = localStorage.getItem(localPassKey());
        const hash = await sha256Hex(pw);
        if (stored !== hash) { privateError.textContent = "パスワードが違います"; return; }
        await showPrivateContent();
      }
    }
  });

  // ---------------------------------------------------------------------
  // Presence ("who is viewing now", Google Slides style avatar stack)
  // ---------------------------------------------------------------------
  const presenceStack = document.getElementById("presenceStack");

  function renderPresence(names) {
    presenceStack.innerHTML = "";
    const unique = Array.from(new Set(names)).slice(0, 6);
    unique.forEach((name) => {
      const av = document.createElement("span");
      av.className = "presence-avatar";
      av.style.background = colorForName(name);
      av.textContent = initialFor(name);
      av.title = name;
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
    updateWhoami();
    if (!currentNickname) {
      nicknameOverlay.classList.add("open");
      setTimeout(() => nicknameInput.focus(), 30);
    }
    await sharedStore.init(REMOTE_ENABLED ? sb : null);
    showPrivateLocked();
    setupPresence();
  }

  bootstrap();
})();
