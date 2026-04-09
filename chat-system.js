(() => {
  if (document.body.dataset.page !== "chat") return;

  const state = {
    currentUser: null,
    users: [],
    usersMap: {},
    presence: {},
    friends: {},
    friendRequests: [],
    groups: [],
    groupRequests: [],
    privateChats: [],
    activeSection: "general",
    activeGroupId: "",
    activePrivateUserId: "",
    activeTypingKey: "",
    activeTypingContext: "",
    selfTypingKey: "",
    selfTypingScope: "",
    selfTypingActive: false,
    activeUploadScope: "",
    generalSettings: {},
    emojis: ["😀", "🔥", "🎉", "😂", "❤️", "👍", "👏"]
  };

  const listeners = [];
  let typingTimeout = null;
  let typingPresenceOff = null;
  let activeGroupMessagesOff = null;
  let activePrivateMessagesOff = null;

  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    try {
      await waitForFirebase();
      firebase.auth().onAuthStateChanged(async (user) => {
        clearListeners();
        if (!user) return;
        state.currentUser = await getUser(user.uid);
        if (!state.currentUser) return;
        bindTabs();
        bindStaticUI();
        loadUsers();
        loadPresence();
        loadFriends();
        loadFriendRequests();
        loadGroups();
        loadPrivateChats();
        loadGeneralSettings();
        loadGeneralMessages();
        handleInitialDeepLink();
      });
    } catch (error) {
      console.error("Chat module init error:", error);
      setStatus("general-chat-status", "No se pudo iniciar el módulo de chats.", "error");
    }
  }

  function waitForFirebase() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts += 1;
        if (typeof firebase !== "undefined" && firebase.apps && firebase.apps.length) {
          clearInterval(timer);
          resolve();
        }
        if (attempts > 80) {
          clearInterval(timer);
          reject(new Error("Firebase no disponible"));
        }
      }, 150);
    });
  }

  function dbRef(path) {
    try {
      const db = firebase.database();
      return db ? db.ref(path) : null;
    } catch (error) {
      console.error("Database no inicializada:", error);
      return null;
    }
  }

  async function getUser(uid) {
    if (!uid) return null;
    const ref = dbRef(`users/${uid}`);
    if (!ref) return null;
    const snapshot = await ref.once("value");
    return snapshot.exists() ? { uid, ...snapshot.val() } : null;
  }

  function bindTabs() {
    $$(".chat-tab").forEach((button) => {
      button.onclick = () => {
        if (state.activeSection !== button.dataset.chatSection) {
          clearTypingState();
          clearTypingPresenceListener();
        }
        state.activeSection = button.dataset.chatSection;
        $$(".chat-tab").forEach((item) => item.classList.remove("active"));
        $$(".chat-section").forEach((section) => section.classList.add("hidden"));
        button.classList.add("active");
        $(`#chat-section-${state.activeSection}`)?.classList.remove("hidden");
        if (state.activeSection === "groups" && state.activeGroupId) {
          subscribeTypingIndicator("group", groupTypingKey(state.activeGroupId));
        }
        if (state.activeSection === "private" && state.activePrivateUserId) {
          subscribeTypingIndicator("private", privateTypingKey(state.activePrivateUserId));
        }
      };
    });
  }

  function bindStaticUI() {
    $("#general-chat-form")?.addEventListener("submit", sendGeneralMessage);
    $("#create-group-toggle")?.addEventListener("click", () => $("#create-group-form")?.classList.toggle("hidden"));
    $("#create-group-form")?.addEventListener("submit", createGroup);
    $("#group-chat-form")?.addEventListener("submit", sendGroupMessage);
    $("#private-chat-form")?.addEventListener("submit", sendPrivateMessage);
    $("#friends-search")?.addEventListener("input", renderUsersDirectory);
    $("#group-file-toggle")?.addEventListener("click", () => $("#group-file-input")?.click());
    $("#private-file-toggle")?.addEventListener("click", () => $("#private-file-input")?.click());
    $("#group-file-input")?.addEventListener("change", (event) => handleFileSelected(event, "group"));
    $("#private-file-input")?.addEventListener("change", (event) => handleFileSelected(event, "private"));
    bindTypingInput("group");
    bindTypingInput("private");
    bindHoverCards();
    bindEmojiComposer("general");
    bindEmojiComposer("group");
    bindEmojiComposer("private");
    if (!window.__chatTypingCleanupBound) {
      window.addEventListener("pagehide", clearTypingState);
      window.addEventListener("beforeunload", clearTypingState);
      window.__chatTypingCleanupBound = true;
    }
  }

  function handleInitialDeepLink() {
    const dm = new URLSearchParams(window.location.search).get("dm");
    if (dm) {
      activateTab("private");
      openPrivateChat(dm);
    }
  }

  function activateTab(name) {
    state.activeSection = name;
    document.querySelector(`[data-chat-section="${name}"]`)?.click();
  }

  function appendMessage(containerId, message) {
    const root = document.getElementById(containerId);
    if (!root) return;

    const div = document.createElement("article");
    div.className = `chat-message ${message.uid === state.currentUser.uid ? "own" : ""}`;

    div.innerHTML = `
    <div class="chat-meta">
      <strong>${escapeHtml(message.username || "usuario")}</strong>
      <span>${escapeHtml(formatTime(message.createdAt))}</span>
    </div>
    <p>${escapeHtml(message.text || "")}</p>
  `;

    root.appendChild(div);
    root.scrollTop = root.scrollHeight;
  }


  function loadUsers() {
    const ref = dbRef("users");
    if (!ref) return;
    const cb = ref.on("value", (snapshot) => {
      state.users = [];
      state.usersMap = {};
      snapshot.forEach((child) => {
        const user = { uid: child.key, ...child.val() };
        state.users.push(user);
        state.usersMap[user.uid] = user;
      });
      renderUsersDirectory();
      renderFriends();
      renderPrivateChatList();
      renderGroups();
      renderGroupRequests();
    });
    listeners.push(() => ref.off("value", cb));
  }

  function loadPresence() {
    const ref = dbRef("presence");
    if (!ref) return;
    const cb = ref.on("value", (snapshot) => {
      state.presence = snapshot.val() || {};
      renderUsersDirectory();
      renderFriends();
      renderPrivateChatList();
      updatePrivateRoomPresence();
    });
    listeners.push(() => ref.off("value", cb));
  }

  function loadFriends() {
    const ref = dbRef(`friends/${state.currentUser.uid}`);
    if (!ref) return;
    const cb = ref.on("value", (snapshot) => {
      state.friends = snapshot.val() || {};
      renderUsersDirectory();
      renderFriends();
      renderPrivateChatList();
    });
    listeners.push(() => ref.off("value", cb));
  }

  function loadFriendRequests() {
    const ref = dbRef(`requests/${state.currentUser.uid}`);
    if (!ref) return;
    const cb = ref.on("value", (snapshot) => {
      const requests = [];
      snapshot.forEach((child) => {
        const item = { id: child.key, ...child.val() };
        if (item.status === "pending" && item.type === "friend") requests.push(item);
      });
      state.friendRequests = requests.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      renderFriendRequests();
    });
    listeners.push(() => ref.off("value", cb));
  }

  function loadGroups() {
    const ref = dbRef("groups");
    if (!ref) return;
    const cb = ref.on("value", async (snapshot) => {
      const groups = [];
      snapshot.forEach((child) => groups.push({ id: child.key, ...child.val() }));
      state.groups = groups.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));
      renderGroups();
      if (state.activeGroupId) {
        const activeGroup = state.groups.find((group) => group.id === state.activeGroupId);
        if (activeGroup) {
          renderGroupManagement(activeGroup);
        }
      }
      await loadGroupRequests();
    });
    listeners.push(() => ref.off("value", cb));
  }

  async function loadGroupRequests() {
    const requests = [];
    const relevantGroups = state.groups.filter((group) => isGroupAdmin(group, state.currentUser.uid));
    for (const group of relevantGroups) {
      const ref = dbRef(`groupRequests/${group.id}`);
      if (!ref) continue;
      const snapshot = await ref.once("value");
      snapshot.forEach((child) => {
        const item = { id: child.key, groupId: group.id, groupName: group.name || "Grupo", ...child.val() };
        if (item.status === "pending") requests.push(item);
      });
    }
    state.groupRequests = requests.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    renderGroupRequests();
  }

  function loadPrivateChats() {
    const ref = dbRef(`userChats/${state.currentUser.uid}`);
    if (!ref) return;
    const cb = ref.on("value", (snapshot) => {
      const chats = [];
      snapshot.forEach((child) => chats.push({ id: child.key, ...child.val() }));
      state.privateChats = chats.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
      renderPrivateChatList();
      chats.forEach((chat) => {
        if (chat.otherUserId) {
          markPrivateMessagesStatus(chat.otherUserId, state.activePrivateUserId === chat.otherUserId ? "seen" : "delivered");
        }
      });
    });
    listeners.push(() => ref.off("value", cb));
  }

  function loadGeneralSettings() {
    const ref = dbRef("platform/chatSettings");
    if (!ref) return;
    const cb = ref.on("value", (snapshot) => {
      state.generalSettings = snapshot.val() || {};
      renderGeneralSettings();
    });
    listeners.push(() => ref.off("value", cb));
  }

  function loadGeneralMessages() {
    const ref = dbRef("chat/messages");
    if (!ref) return;
    const query = ref.orderByChild("createdAt").limitToLast(120);
    query.on("child_added", (snapshot) => {
      const message = { id: snapshot.key, ...snapshot.val() };
      appendMessage("general-chat-messages", message);
    });

    listeners.push(() => query.off("value", cb));
  }

  function renderGeneralSettings() {
    const restriction = canWriteGeneral();
    setText("general-chat-meta", restriction.meta);
    setText("general-chat-access", restriction.allowed ? "Disponible" : "Restringido");
    setText("general-chat-rank", state.currentUser.rango || "Free");
    setBadge("general-chat-rank", state.currentUser.rango);
    const input = $("#general-chat-input");
    const button = $("#general-chat-form button");
    if (input) input.disabled = !restriction.allowed;
    if (button) button.disabled = !restriction.allowed;
    setStatus("general-chat-status", restriction.allowed ? "" : restriction.message, restriction.allowed ? "" : "error");
  }

  async function sendGeneralMessage(event) {
    event.preventDefault();
    const input = $("#general-chat-input");
    const text = input?.value.trim();
    if (!text) return;
    const restriction = canWriteGeneral();
    if (!restriction.allowed) {
      setStatus("general-chat-status", restriction.message, "error");
      return;
    }
    if (text.startsWith("/")) {
      const handled = await handleChatCommand(text, "general");
      if (handled) {
        input.value = "";
        return;
      }
    }
    const ref = dbRef("chat/messages");
    if (!ref) return;
    await ref.push({
      uid: state.currentUser.uid,
      username: state.currentUser.username,
      rango: state.currentUser.rango || "Free",
      text,
      type: "text",
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    await addXP(rollXP());
    await awardChatActivity();
    notifyUsersForGeneral();
    input.value = "";
  }

  function renderUsersDirectory() {
    const root = $("#users-directory-list");
    if (!root) return;
    const query = String($("#friends-search")?.value || "").toLowerCase().trim();
    const users = state.users.filter((user) => user.uid !== state.currentUser.uid && !user.banned).filter((user) => {
      const haystack = `${getFullName(user)} ${user.username || ""} ${user.curso || ""}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    root.innerHTML = users.length ? users.map((user) => {
      const isFriend = Boolean(state.friends[user.uid]);
      const presence = getPresenceLabel(user);
      const privacy = user.profilePrivate ? "Privada" : "Pública";
      return `
        <div class="friend-card">
          <strong class="hover-user-trigger" data-hover-user="${user.uid}">${escapeHtml(getFullName(user))}</strong>
          <p>@${escapeHtml(user.username || "usuario")} · ${escapeHtml(user.curso || "Sin curso")}</p>
          <div class="inline-meta">
            <span class="presence-chip ${presence.className}">${escapeHtml(presence.text)}</span>
            <span class="mini-chip">${privacy}</span>
            <span class="badge ${getRangeClass(user.rango)}">${escapeHtml(user.rango || "Free")}</span>
          </div>
          <div class="chat-row-actions">
            <button class="ghost-btn" data-start-contact="${user.uid}" type="button">${isFriend || !user.profilePrivate || isAdmin() ? "Chatear" : "Solicitar amistad"}</button>
          </div>
        </div>
      `;
    }).join("") : `<div class="center-note">No hay usuarios disponibles.</div>`;

    root.querySelectorAll("[data-start-contact]").forEach((button) => {
      button.onclick = () => startContact(button.dataset.startContact);
    });
    bindHoverCards(root);
  }

  function renderFriends() {
    const root = $("#friends-list");
    if (!root) return;
    const entries = Object.keys(state.friends).map((uid) => state.usersMap[uid]).filter(Boolean);
    root.innerHTML = entries.length ? entries.map((user) => `
      <div class="friend-card">
        <strong class="hover-user-trigger" data-hover-user="${user.uid}">${escapeHtml(getFullName(user))}</strong>
        <p>@${escapeHtml(user.username || "usuario")}</p>
        <div class="inline-meta">
          <span class="presence-chip ${getPresenceLabel(user).className}">${escapeHtml(getPresenceLabel(user).text)}</span>
        </div>
        <div class="chat-row-actions">
          <button class="ghost-btn" data-open-friend-chat="${user.uid}" type="button">Abrir chat</button>
          <button class="ghost-btn" data-remove-friend="${user.uid}" type="button">Eliminar amigo</button>
        </div>
      </div>
    `).join("") : `<div class="center-note">Todavía no tienes amigos.</div>`;

    root.querySelectorAll("[data-open-friend-chat]").forEach((button) => button.onclick = () => {
      activateTab("private");
      openPrivateChat(button.dataset.openFriendChat);
    });

    root.querySelectorAll("[data-remove-friend]").forEach((button) => button.onclick = () => removeFriend(button.dataset.removeFriend));
    bindHoverCards(root);
  }

  function renderFriendRequests() {
    const root = $("#friend-requests-list");
    if (!root) return;
    root.innerHTML = state.friendRequests.length ? state.friendRequests.map((request) => {
      const fromUser = state.usersMap[request.from];
      return `
        <div class="request-card">
          <strong>${escapeHtml(fromUser ? getFullName(fromUser) : "Usuario")}</strong>
          <p>@${escapeHtml(fromUser?.username || request.from)}</p>
          <div class="chat-row-actions">
            <button class="primary-btn" data-accept-friend="${request.id}" type="button">Aceptar</button>
            <button class="ghost-btn" data-reject-friend="${request.id}" type="button">Rechazar</button>
          </div>
        </div>
      `;
    }).join("") : `<div class="center-note">No hay solicitudes pendientes.</div>`;

    root.querySelectorAll("[data-accept-friend]").forEach((button) => button.onclick = () => handleFriendRequest(button.dataset.acceptFriend, "accepted"));
    root.querySelectorAll("[data-reject-friend]").forEach((button) => button.onclick = () => handleFriendRequest(button.dataset.rejectFriend, "rejected"));
  }

  function renderGroupRequests() {
    const root = $("#group-requests-list");
    if (!root) return;
    root.innerHTML = state.groupRequests.length ? state.groupRequests.map((request) => {
      const user = state.usersMap[request.userId];
      return `
        <div class="request-card">
          <strong>${escapeHtml(request.groupName || "Grupo")}</strong>
          <p>${escapeHtml(user ? getFullName(user) : request.userId)}</p>
          <div class="chat-row-actions">
            <button class="primary-btn" data-accept-group="${request.groupId}|${request.userId}" type="button">Aceptar</button>
            <button class="ghost-btn" data-reject-group="${request.groupId}|${request.userId}" type="button">Rechazar</button>
          </div>
        </div>
      `;
    }).join("") : `<div class="center-note">No hay solicitudes de grupos.</div>`;

    root.querySelectorAll("[data-accept-group]").forEach((button) => button.onclick = () => handleGroupRequest(button.dataset.acceptGroup, "accepted"));
    root.querySelectorAll("[data-reject-group]").forEach((button) => button.onclick = () => handleGroupRequest(button.dataset.rejectGroup, "rejected"));
  }

  function renderGroups() {
    const root = $("#groups-list");
    if (!root) return;
    root.innerHTML = state.groups.length ? state.groups.map((group) => {
      const member = isGroupMember(group, state.currentUser.uid);
      const admin = isGroupAdmin(group, state.currentUser.uid);
      const privacy = group.privacy === "private" ? "Privado" : "Público";
      const action = member ? "Abrir" : group.privacy === "private" ? "Solicitar" : "Unirse";
      return `
        <div class="group-card">
          <strong>${escapeHtml(group.name || "Grupo")}</strong>
          <p>${escapeHtml(group.description || "Sin descripción")}</p>
          <div class="inline-meta">
            <span class="mini-chip">${privacy}</span>
            ${admin ? '<span class="badge admin">Admin</span>' : ""}
          </div>
          <div class="chat-row-actions">
            <button class="ghost-btn" data-group-action="${action.toLowerCase()}" data-group-id="${group.id}" type="button">${action}</button>
          </div>
        </div>
      `;
    }).join("") : `<div class="center-note">Aún no hay grupos.</div>`;

    root.querySelectorAll("[data-group-action]").forEach((button) => {
      button.onclick = () => handleGroupAction(button.dataset.groupAction, button.dataset.groupId);
    });
  }

  async function createGroup(event) {
    event.preventDefault();
    const name = $("#group-name").value.trim();
    const description = $("#group-description").value.trim();
    const image = $("#group-image").value.trim();
    const privacy = $("#group-privacy").value.trim().toLowerCase() === "private" ? "private" : "public";
    if (!name) {
      setStatus("group-create-status", "El grupo necesita nombre.", "error");
      return;
    }
    const ref = dbRef("groups");
    if (!ref) return;
    const groupRef = ref.push();
    await groupRef.set({
      name,
      description,
      image,
      privacy,
      ownerId: state.currentUser.uid,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      members: { [state.currentUser.uid]: true },
      admins: { [state.currentUser.uid]: true }
    });
    if (typeof window.pushAppNotification === "function") {
      await window.pushAppNotification(state.currentUser.uid, { title: "Grupo creado", message: `Has creado ${name}`, type: "group" });
    }
    await logActivity("group_create", { groupName: name, privacy });
    $("#create-group-form").reset();
    $("#create-group-form").classList.add("hidden");
    setStatus("group-create-status", "Grupo creado.", "success");
  }

  async function handleGroupAction(action, groupId) {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) return;
    if (action === "abrir") return openGroup(groupId);
    if (action === "unirse") {
      await dbRef(`groups/${groupId}/members/${state.currentUser.uid}`)?.set(true);
      return openGroup(groupId);
    }
    if (action === "solicitar") {
      const reqRef = dbRef(`groupRequests/${groupId}/${state.currentUser.uid}`);
      if (!reqRef) return;
      await reqRef.set({
        userId: state.currentUser.uid,
        status: "pending",
        createdAt: firebase.database.ServerValue.TIMESTAMP
      });
      await notifyGroupAdmins(group, "Solicitud de grupo", `${state.currentUser.username} quiere unirse a ${group.name}`);
      setStatus("group-chat-status", "Solicitud enviada al grupo.", "success");
    }
  }

  function openGroup(groupId) {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) return;
    clearTypingState();
    state.activeGroupId = groupId;
    state.activePrivateUserId = "";
    setText("group-room-title", group.name || "Grupo");
    setText("group-room-meta", group.description || "Chat del grupo");
    const membershipChip = document.getElementById("group-room-membership");
    if (membershipChip) {
      membershipChip.textContent = isGroupAdmin(group, state.currentUser.uid) ? "Admin" : "Miembro";
      membershipChip.classList.remove("hidden");
    }
    renderGroupManagement(group);
    subscribeGroupMessages(groupId);
    subscribeTypingIndicator("group", groupTypingKey(groupId));
  }

  function subscribeGroupMessages(groupId) {
    if (activeGroupMessagesOff) {
      activeGroupMessagesOff();
      activeGroupMessagesOff = null;
    }
    const ref = dbRef(`groupChats/${groupId}/messages`);
    if (!ref) return;
    const query = ref.orderByChild("createdAt").limitToLast(120);
    query.on("child_added", (snapshot) => {
      const message = { id: snapshot.key, ...snapshot.val() };
      appendMessage("group-chat-messages", message);
    });

    activeGroupMessagesOff = () => query.off("value", cb);
    listeners.push(activeGroupMessagesOff);
  }

  async function sendGroupMessage(event) {
    event.preventDefault();
    if (!state.activeGroupId) {
      setStatus("group-chat-status", "Selecciona un grupo primero.", "error");
      return;
    }
    const group = state.groups.find((item) => item.id === state.activeGroupId);
    if (!group || !isGroupMember(group, state.currentUser.uid)) {
      setStatus("group-chat-status", "No eres miembro del grupo.", "error");
      return;
    }
    const input = $("#group-chat-input");
    const text = input.value.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      const handled = await handleChatCommand(text, "group");
      if (handled) {
        input.value = "";
        clearTypingState();
        return;
      }
    }
    const ref = dbRef(`groupChats/${state.activeGroupId}/messages`);
    if (!ref) return;
    await ref.push({
      uid: state.currentUser.uid,
      username: state.currentUser.username,
      rango: state.currentUser.rango || "Free",
      text,
      type: "text",
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    await addXP(rollXP());
    await awardChatActivity();
    await notifyGroupMembers(group, text);
    input.value = "";
    clearTypingState();
  }

  function renderPrivateChatList() {
    const root = $("#private-chat-list");
    if (!root) return;
    root.innerHTML = state.privateChats.length ? state.privateChats.map((chat) => {
      const target = state.usersMap[chat.otherUserId];
      const presence = getPresenceLabel(target);
      return `
        <div class="conversation-card">
          <strong class="hover-user-trigger" data-hover-user="${chat.otherUserId}">${escapeHtml(target ? getFullName(target) : chat.otherUsername || "Usuario")}</strong>
          <p>${escapeHtml(chat.lastMessage || "Sin mensajes")}</p>
          <div class="inline-meta">
            <span class="presence-chip ${presence.className}">${escapeHtml(presence.text)}</span>
          </div>
          <div class="chat-row-actions">
            <button class="ghost-btn" data-open-private="${chat.otherUserId}" type="button">Abrir</button>
          </div>
        </div>
      `;
    }).join("") : `<div class="center-note">No tienes conversaciones privadas.</div>`;

    root.querySelectorAll("[data-open-private]").forEach((button) => button.onclick = () => openPrivateChat(button.dataset.openPrivate));
    bindHoverCards(root);
  }

  async function startContact(targetUid) {
    const target = state.usersMap[targetUid];
    if (!target) return;
    const isFriend = Boolean(state.friends[targetUid]);
    if (isFriend || !target.profilePrivate || isAdmin()) {
      activateTab("private");
      openPrivateChat(targetUid);
      return;
    }
    await sendFriendRequest(targetUid);
  }

  async function sendFriendRequest(targetUid) {
    const ref = dbRef(`requests/${targetUid}`);
    if (!ref) return;
    const snapshot = await ref.once("value");
    let duplicate = false;
    snapshot.forEach((child) => {
      const item = child.val() || {};
      if (item.from === state.currentUser.uid && item.type === "friend" && item.status === "pending") duplicate = true;
    });
    if (duplicate) {
      activateTab("requests");
      return;
    }
    await ref.push({
      from: state.currentUser.uid,
      to: targetUid,
      type: "friend",
      status: "pending",
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    if (typeof window.pushAppNotification === "function") {
      await window.pushAppNotification(targetUid, {
        title: "Nueva solicitud de amistad",
        message: `${state.currentUser.username} te ha enviado una solicitud`,
        type: "friend"
      });
    }
    await logActivity("friend_request", { targetUserId: targetUid });
    activateTab("requests");
  }

  async function handleFriendRequest(requestId, nextStatus) {
    const request = state.friendRequests.find((item) => item.id === requestId);
    if (!request) return;
    const ref = dbRef(`requests/${state.currentUser.uid}/${requestId}`);
    if (!ref) return;
    await ref.update({ status: nextStatus });
    if (nextStatus === "accepted") {
      await dbRef(`friends/${state.currentUser.uid}/${request.from}`)?.set(true);
      await dbRef(`friends/${request.from}/${state.currentUser.uid}`)?.set(true);
      if (typeof window.pushAppNotification === "function") {
        await window.pushAppNotification(request.from, {
          title: "Solicitud aceptada",
          message: `${state.currentUser.username} ha aceptado tu solicitud`,
          type: "friend"
        });
      }
    }
  }

  async function removeFriend(friendUid) {
    await dbRef(`friends/${state.currentUser.uid}/${friendUid}`)?.remove();
    await dbRef(`friends/${friendUid}/${state.currentUser.uid}`)?.remove();
  }

  async function handleGroupRequest(payload, nextStatus) {
    const [groupId, userId] = payload.split("|");
    const ref = dbRef(`groupRequests/${groupId}/${userId}`);
    if (!ref) return;
    await ref.update({ status: nextStatus });
    if (nextStatus === "accepted") {
      await dbRef(`groups/${groupId}/members/${userId}`)?.set(true);
      if (typeof window.pushAppNotification === "function") {
        await window.pushAppNotification(userId, {
          title: "Solicitud de grupo aceptada",
          message: `Ya puedes entrar al grupo ${state.groups.find((g) => g.id === groupId)?.name || ""}`,
          type: "group"
        });
      }
    }
    await loadGroupRequests();
    const group = state.groups.find((item) => item.id === groupId);
    if (group && state.activeGroupId === groupId) {
      renderGroupManagement(group);
    }
  }

  function renderGroupManagement(group) {
    const panel = $("#group-management-panel");
    const root = $("#group-members-list");
    if (!panel || !root || !group) return;
    const canManage = isGroupAdmin(group, state.currentUser.uid);
    panel.classList.toggle("hidden", !canManage);
    if (!canManage) {
      root.innerHTML = "";
      setStatus("group-management-status", "");
      return;
    }

    const ownerId = group.ownerId || "";
    const memberIds = Array.from(new Set([
      ...Object.keys(group.members || {}),
      ...Object.keys(group.admins || {}),
      ownerId
    ].filter(Boolean)));

    setText("group-management-meta", `${memberIds.length} miembros · ${group.privacy === "private" ? "Privado" : "Publico"}`);

    root.innerHTML = memberIds.length ? memberIds.map((uid) => {
      const user = state.usersMap[uid];
      const role = uid === ownerId ? "owner" : isGroupAdmin(group, uid) ? "admin" : "member";
      const canEditRole = state.currentUser.uid === ownerId && uid !== ownerId;
      const canRemove = uid !== ownerId && (state.currentUser.uid === ownerId || !isGroupAdmin(group, uid));
      return `
        <div class="friend-card group-member-card">
          <div>
            <strong>${escapeHtml(user ? getFullName(user) : uid)}</strong>
            <p>@${escapeHtml(user?.username || uid)} · ${escapeHtml(user?.curso || "Sin curso")}</p>
          </div>
          <div class="inline-meta">
            <span class="badge ${role === "owner" ? "admin" : role === "admin" ? "vip" : "free"}">${role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Member"}</span>
          </div>
          <div class="chat-row-actions">
            ${canEditRole ? `
              <select class="group-role-select" data-group-role-user="${uid}">
                <option value="member" ${role === "member" ? "selected" : ""}>Member</option>
                <option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option>
              </select>
            ` : ""}
            ${canRemove ? `<button class="ghost-btn" data-group-remove-user="${uid}" type="button">Expulsar</button>` : ""}
          </div>
        </div>
      `;
    }).join("") : `<div class="center-note">No hay miembros cargados.</div>`;

    root.querySelectorAll("[data-group-role-user]").forEach((select) => {
      select.onchange = () => updateGroupMemberRole(group.id, select.dataset.groupRoleUser, select.value);
    });
    root.querySelectorAll("[data-group-remove-user]").forEach((button) => {
      button.onclick = () => removeGroupMember(group.id, button.dataset.groupRemoveUser);
    });
  }

  async function updateGroupMemberRole(groupId, userId, role) {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group || group.ownerId !== state.currentUser.uid) {
      setStatus("group-management-status", "Solo el owner puede cambiar roles.", "error");
      return;
    }
    const adminRef = dbRef(`groups/${groupId}/admins/${userId}`);
    if (!adminRef) return;
    if (role === "admin") {
      await adminRef.set(true);
    } else {
      await adminRef.remove();
    }
    setStatus("group-management-status", "Rol actualizado.", "success");
    await logActivity("group_role", { groupId, targetUserId: userId, role });
  }

  async function removeGroupMember(groupId, userId) {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group || !isGroupAdmin(group, state.currentUser.uid)) {
      setStatus("group-management-status", "No tienes permisos para expulsar.", "error");
      return;
    }
    if (group.ownerId === userId) {
      setStatus("group-management-status", "No puedes expulsar al owner.", "error");
      return;
    }
    await dbRef(`groups/${groupId}/members/${userId}`)?.remove();
    await dbRef(`groups/${groupId}/admins/${userId}`)?.remove();
    setStatus("group-management-status", "Miembro expulsado.", "success");
    await logActivity("group_remove_member", { groupId, targetUserId: userId });
  }

  function openPrivateChat(targetUid) {
    clearTypingState();
    state.activePrivateUserId = targetUid;
    state.activeGroupId = "";
    const user = state.usersMap[targetUid];
    setText("private-room-title", user ? getFullName(user) : "Chat privado");
    setText("private-room-meta", user ? `@${user.username || "usuario"}` : "Conversación directa");
    updatePrivateRoomPresence();
    subscribePrivateMessages(targetUid);
    subscribeTypingIndicator("private", privateTypingKey(targetUid));
    markPrivateMessagesStatus(targetUid, "seen");
  }

  function subscribePrivateMessages(targetUid) {
    if (activePrivateMessagesOff) {
      activePrivateMessagesOff();
      activePrivateMessagesOff = null;
    }
    const chatId = privateChatId(state.currentUser.uid, targetUid);
    const ref = dbRef(`privateChats/${chatId}/messages`);
    if (!ref) return;
    const query = ref.orderByChild("createdAt").limitToLast(120);
    query.on("child_added", (snapshot) => {
      const message = { id: snapshot.key, ...snapshot.val() };
      appendMessage("private-chat-messages", message);
    });

    activePrivateMessagesOff = () => query.off("value", cb);
    listeners.push(activePrivateMessagesOff);
  }

  async function sendPrivateMessage(event) {
    event.preventDefault();
    if (!state.activePrivateUserId) {
      setStatus("private-chat-status", "Selecciona una conversación.", "error");
      return;
    }
    const target = state.usersMap[state.activePrivateUserId];
    if (!target) return;
    const isFriend = Boolean(state.friends[target.uid]);
    if (target.profilePrivate && !isFriend && !isAdmin()) {
      setStatus("private-chat-status", "La cuenta es privada. Necesitas amistad aceptada.", "error");
      return;
    }
    const input = $("#private-chat-input");
    const text = input.value.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      const handled = await handleChatCommand(text, "private");
      if (handled) {
        input.value = "";
        clearTypingState();
        return;
      }
    }
    const chatId = privateChatId(state.currentUser.uid, target.uid);
    const ref = dbRef(`privateChats/${chatId}/messages`);
    if (!ref) return;
    await dbRef(`privateChats/${chatId}/participants`)?.set({ [state.currentUser.uid]: true, [target.uid]: true });
    await ref.push({
      uid: state.currentUser.uid,
      username: state.currentUser.username,
      rango: state.currentUser.rango || "Free",
      text,
      type: "text",
      status: getPresenceLabel(target).className === "online" ? "delivered" : "sent",
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    await upsertPrivateChatIndex(target.uid, text);
    await addXP(rollXP());
    await awardChatActivity();
    if (typeof window.pushAppNotification === "function") {
      await window.pushAppNotification(target.uid, {
        title: "Nuevo mensaje privado",
        message: `${state.currentUser.username}: ${text.slice(0, 60)}`,
        type: "message"
      });
    }
    input.value = "";
    clearTypingState();
  }

  async function upsertPrivateChatIndex(otherUid, lastMessage) {
    const otherUser = state.usersMap[otherUid];
    const payloadForMe = {
      otherUserId: otherUid,
      otherUsername: otherUser?.username || "usuario",
      lastMessage,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    };
    const payloadForThem = {
      otherUserId: state.currentUser.uid,
      otherUsername: state.currentUser.username || "usuario",
      lastMessage,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    };
    await dbRef(`userChats/${state.currentUser.uid}/${otherUid}`)?.update(payloadForMe);
    await dbRef(`userChats/${otherUid}/${state.currentUser.uid}`)?.update(payloadForThem);
  }

  async function markPrivateMessagesStatus(otherUid, nextStatus) {
    if (!otherUid || !state.currentUser) return;
    const chatId = privateChatId(state.currentUser.uid, otherUid);
    const ref = dbRef(`privateChats/${chatId}/messages`);
    if (!ref) return;
    const snapshot = await ref.once("value");
    const updates = {};
    snapshot.forEach((child) => {
      const message = child.val() || {};
      if (message.uid !== state.currentUser.uid && shouldPromoteMessageStatus(message.status, nextStatus)) {
        updates[`${child.key}/status`] = nextStatus;
        if (nextStatus === "seen") {
          updates[`${child.key}/seenAt`] = firebase.database.ServerValue.TIMESTAMP;
        }
      }
    });
    if (Object.keys(updates).length) {
      await ref.update(updates);
    }
  }

  function shouldPromoteMessageStatus(currentStatus, nextStatus) {
    const order = { sent: 0, delivered: 1, seen: 2 };
    return (order[nextStatus] ?? 0) > (order[currentStatus || "sent"] ?? 0);
  }

  async function handleFileSelected(event, scope) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (scope === "private") {
        await sendPrivateFile(file);
      }
      if (scope === "group") {
        await sendGroupFile(file);
      }
    } catch (error) {
      console.error(error);
      setStatus(`${scope}-chat-status`, "No se pudo subir el archivo.", "error");
    } finally {
      event.target.value = "";
    }
  }

  async function sendPrivateFile(file) {
    if (!state.activePrivateUserId) {
      setStatus("private-chat-status", "Selecciona una conversación.", "error");
      return;
    }
    const target = state.usersMap[state.activePrivateUserId];
    if (!target) return;
    const chatId = privateChatId(state.currentUser.uid, target.uid);
    const fileURL = await uploadChatFile(chatId, file);
    const ref = dbRef(`privateChats/${chatId}/messages`);
    if (!ref) return;
    const messageType = getFileMessageType(file);
    await dbRef(`privateChats/${chatId}/participants`)?.set({ [state.currentUser.uid]: true, [target.uid]: true });
    await ref.push({
      uid: state.currentUser.uid,
      username: state.currentUser.username,
      rango: state.currentUser.rango || "Free",
      type: messageType,
      fileURL,
      fileName: file.name,
      fileSize: file.size,
      status: getPresenceLabel(target).className === "online" ? "delivered" : "sent",
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    await upsertPrivateChatIndex(target.uid, `[Archivo] ${file.name}`);
    await awardChatActivity();
    setStatus("private-chat-status", "Archivo enviado.", "success");
  }

  async function sendGroupFile(file) {
    if (!state.activeGroupId) {
      setStatus("group-chat-status", "Selecciona un grupo primero.", "error");
      return;
    }
    const group = state.groups.find((item) => item.id === state.activeGroupId);
    if (!group || !isGroupMember(group, state.currentUser.uid)) {
      setStatus("group-chat-status", "No eres miembro del grupo.", "error");
      return;
    }
    const fileURL = await uploadChatFile(`group_${state.activeGroupId}`, file);
    const ref = dbRef(`groupChats/${state.activeGroupId}/messages`);
    if (!ref) return;
    await ref.push({
      uid: state.currentUser.uid,
      username: state.currentUser.username,
      rango: state.currentUser.rango || "Free",
      type: getFileMessageType(file),
      fileURL,
      fileName: file.name,
      fileSize: file.size,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    await awardChatActivity();
    setStatus("group-chat-status", "Archivo enviado.", "success");
  }

  async function uploadChatFile(chatId, file) {
    const storageApp = window.getAppStorage ? window.getAppStorage() : (window.appStorage || null);
    if (!storageApp) {
      throw new Error("Storage no inicializado");
    }
    const safeName = `${Date.now()}_${String(file.name || "archivo").replace(/\s+/g, "_")}`;
    const ref = storageApp.ref(`files/${chatId}/${safeName}`);
    await ref.put(file);
    return ref.getDownloadURL();
  }

  function getFileMessageType(file) {
    if (String(file.type || "").startsWith("image/")) {
      return "image";
    }
    return "file";
  }

  async function awardChatActivity() {
    const userRef = dbRef(`users/${state.currentUser.uid}`);
    if (!userRef) return;
    const result = await userRef.transaction((userData) => {
      if (!userData) return userData;
      const nextMessages = Number(userData.messagesCount || 0) + 1;
      const nextCoins = Number(userData.coins ?? userData.balance ?? 0) + 3;
      return {
        ...userData,
        messagesCount: nextMessages,
        coins: nextCoins,
        balance: nextCoins
      };
    });
    if (!result.committed || !result.snapshot.exists()) return;
    state.currentUser = { uid: state.currentUser.uid, ...result.snapshot.val() };
    await registerDailyMissionProgress("messages", 1);
    await logActivity("message", {
      section: state.activeSection,
      groupId: state.activeGroupId || null,
      privateUserId: state.activePrivateUserId || null
    });
    await evaluateChatAchievements(state.currentUser);
  }

  async function registerDailyMissionProgress(kind, amount = 1) {
    if (!state.currentUser?.uid) return;
    const key = new Date().toISOString().slice(0, 10);
    const ref = dbRef(`daily/${state.currentUser.uid}/${key}`);
    if (!ref) return;
    const result = await ref.transaction((data) => {
      const current = data || { dateKey: key, messages: 0, completed: false };
      const nextMessages = Number(current.messages || 0) + amount;
      const justCompleted = !current.completed && nextMessages >= 5;
      return {
        ...current,
        dateKey: key,
        messages: nextMessages,
        completed: current.completed || justCompleted,
        rewardClaimed: current.rewardClaimed || false,
        updatedAt: Date.now()
      };
    });
    if (!result.committed || !result.snapshot.exists()) return;
    const mission = result.snapshot.val() || {};
    if (mission.completed && !mission.rewardClaimed) {
      await dbRef(`daily/${state.currentUser.uid}/${key}`)?.update({ rewardClaimed: true });
      await addXP(20);
      const userRef = dbRef(`users/${state.currentUser.uid}`);
      if (userRef) {
        const userResult = await userRef.transaction((userData) => {
          if (!userData) return userData;
          const nextCoins = Number(userData.coins ?? userData.balance ?? 0) + 25;
          return { ...userData, coins: nextCoins, balance: nextCoins };
        });
        if (userResult.committed && userResult.snapshot.exists()) {
          state.currentUser = { uid: state.currentUser.uid, ...userResult.snapshot.val() };
        }
      }
      if (typeof window.pushAppNotification === "function") {
        await window.pushAppNotification(state.currentUser.uid, {
          title: "Mision diaria completada",
          message: "Has enviado 5 mensajes y ganado XP + coins",
          type: "system"
        });
      }
    }
  }

  async function logActivity(type, payload = {}) {
    if (!state.currentUser?.uid) return;
    await dbRef(`activity/${state.currentUser.uid}`)?.push({
      type,
      ...payload,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  async function evaluateChatAchievements(user) {
    const ref = dbRef(`achievements/${user.uid}`);
    if (!ref) return;
    const snapshot = await ref.once("value");
    const current = snapshot.val() || {};
    const next = {};
    if (Number(user.messagesCount || 0) >= 1 && !current.first_message) {
      next.first_message = { title: "Primer mensaje", createdAt: firebase.database.ServerValue.TIMESTAMP };
    }
    if (Number(user.messagesCount || 0) >= 100 && !current.hundred_messages) {
      next.hundred_messages = { title: "100 mensajes", createdAt: firebase.database.ServerValue.TIMESTAMP };
    }
    if (Number(user.nivel || 1) >= 5 && !current.level_5) {
      next.level_5 = { title: "Nivel 5", createdAt: firebase.database.ServerValue.TIMESTAMP };
    }
    if (!Object.keys(next).length) return;
    await ref.update(next);
    if (typeof window.pushAppNotification === "function") {
      const first = Object.values(next)[0];
      if (first?.title) {
        await window.pushAppNotification(user.uid, {
          title: "Logro desbloqueado",
          message: first.title,
          type: "achievement"
        });
      }
    }
  }

  function bindTypingInput(scope) {
    const input = document.getElementById(`${scope}-chat-input`);
    if (!input) return;
    input.addEventListener("input", () => {
      if (!String(input.value || "").trim()) {
        clearTypingState();
        return;
      }
      setTyping(true, scope);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        setTyping(false, scope);
      }, 2000);
    });
    input.addEventListener("blur", clearTypingState);
  }

  function setTyping(isTyping, scope) {
    if (!state.currentUser) return;
    const typingKey = getTypingKey(scope);
    if (!typingKey) return;
    const ref = dbRef(`typing/${typingKey}/${state.currentUser.uid}`);
    if (!ref) return;
    if (isTyping) {
      if (state.selfTypingActive && state.selfTypingKey === typingKey && state.selfTypingScope === scope) {
        return;
      }
      if (state.selfTypingActive && state.selfTypingKey && state.selfTypingKey !== typingKey) {
        dbRef(`typing/${state.selfTypingKey}/${state.currentUser.uid}`)?.remove();
      }
      ref.onDisconnect().remove();
      ref.set(true);
      state.selfTypingActive = true;
      state.selfTypingKey = typingKey;
      state.selfTypingScope = scope;
      return;
    }

    const targetKey = state.selfTypingKey || typingKey;
    if (!targetKey) return;
    dbRef(`typing/${targetKey}/${state.currentUser.uid}`)?.remove();
    state.selfTypingActive = false;
    state.selfTypingKey = "";
    state.selfTypingScope = "";
  }

  function subscribeTypingIndicator(scope, typingKey) {
    clearTypingPresenceListener();
    hideTyping(scope);
    if (!typingKey) return;
    state.activeTypingContext = scope;
    state.activeTypingKey = typingKey;
    const ref = dbRef(`typing/${typingKey}`);
    if (!ref) return;
    const cb = ref.on("value", (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        hideTyping(scope);
        return;
      }
      const usersTyping = Object.keys(data)
        .filter((uid) => uid !== state.currentUser.uid)
        .map((uid) => state.usersMap[uid])
        .filter(Boolean);
      if (usersTyping.length) showTyping(scope, usersTyping);
      else hideTyping(scope);
    });
    typingPresenceOff = () => ref.off("value", cb);
  }

  function showTyping(scope, users) {
    const el = document.getElementById(`${scope}-typing-indicator`);
    if (!el) return;
    const text = users.length === 1
      ? `${getFullName(users[0]) || users[0].username || "Alguien"} esta escribiendo`
      : "Varias personas estan escribiendo";
    el.innerHTML = `<span class="typing-indicator-text">${escapeHtml(text)}</span><span class="typing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>`;
    el.classList.remove("hidden");
  }

  function hideTyping(scope) {
    const el = document.getElementById(`${scope}-typing-indicator`);
    if (!el) return;
    el.innerHTML = "";
    el.classList.add("hidden");
  }

  function clearTypingState() {
    clearTimeout(typingTimeout);
    typingTimeout = null;
    if (state.selfTypingActive || state.selfTypingKey) {
      const ref = dbRef(`typing/${state.selfTypingKey}/${state.currentUser?.uid || ""}`);
      ref?.remove();
    }
    state.selfTypingActive = false;
    state.selfTypingKey = "";
    state.selfTypingScope = "";
  }

  function clearTypingPresenceListener() {
    if (typingPresenceOff) {
      typingPresenceOff();
      typingPresenceOff = null;
    }
    state.activeTypingContext = "";
    state.activeTypingKey = "";
    hideTyping("group");
    hideTyping("private");
  }

  function getTypingKey(scope) {
    if (scope === "group" && state.activeGroupId) return groupTypingKey(state.activeGroupId);
    if (scope === "private" && state.activePrivateUserId) return privateTypingKey(state.activePrivateUserId);
    return "";
  }

  function groupTypingKey(groupId) {
    return groupId ? `group_${groupId}` : "";
  }

  function privateTypingKey(targetUid) {
    return targetUid ? `private_${privateChatId(state.currentUser.uid, targetUid)}` : "";
  }

  async function addXP(amount) {
    const ref = dbRef(`users/${state.currentUser.uid}`);
    if (!ref) return;
    const previousLevel = levelFromXP(state.currentUser.xp || 0);
    const result = await ref.transaction((data) => {
      if (!data) return data;
      const xp = Number(data.xp || 0) + amount;
      return { ...data, xp, nivel: levelFromXP(xp) };
    });
    if (!result.committed || !result.snapshot.exists()) return;
    state.currentUser = { uid: state.currentUser.uid, ...result.snapshot.val() };
    if (levelFromXP(state.currentUser.xp || 0) > previousLevel) {
      alert("¡Subiste de nivel!");
    }
  }

  function renderMessageStream(id, messages, context, contextId = "") {
    const root = document.getElementById(id);
    if (!root) return;
    root.innerHTML = messages.length ? messages.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)).map((message) => `
      <article class="chat-message ${message.uid === state.currentUser.uid ? "own" : ""}">
        <div class="chat-meta">
          <span class="badge ${getRangeClass(message.rango)}">${escapeHtml(message.rango || "Free")}</span>
          <strong class="hover-user-trigger" data-hover-user="${message.uid}">${escapeHtml(message.username || "usuario")}</strong>
          <span>${escapeHtml(formatTime(message.createdAt))}</span>
        </div>
        ${renderMessageBody(message)}
        ${context === "private" && message.uid === state.currentUser.uid ? `<div class="message-status ${message.status || "sent"}">${escapeHtml(getMessageStatusLabel(message.status || "sent"))}</div>` : ""}
        ${renderReactions(message.reactions, context, contextId, message.id)}
        <div class="message-actions">
          <button class="message-action-btn" data-reaction-toggle="${context}|${contextId}|${message.id}" type="button">😀</button>
          ${message.uid === state.currentUser.uid && (message.type || "text") === "text" ? `<button class="message-action-btn" data-edit-message="${context}|${contextId}|${message.id}" type="button">Editar</button>` : ""}
          ${message.uid === state.currentUser.uid || isAdmin() ? `<button class="message-action-btn" data-delete-message="${context}|${contextId}|${message.id}" type="button">Eliminar</button>` : ""}
        </div>
        <div class="emoji-picker hidden" id="picker-${context}-${contextId || "root"}-${message.id}">
          ${state.emojis.map((emoji) => `<button class="emoji-choice" data-react="${context}|${contextId}|${message.id}|${emoji}" type="button">${emoji}</button>`).join("")}
        </div>
      </article>
    `).join("") : `<div class="center-note">No hay mensajes todavía.</div>`;
    root.scrollTop = root.scrollHeight;
    bindMessageActions(root, context, contextId);
  }

  function renderReactions(reactions, context, contextId, messageId) {
    if (!reactions) return "";
    const items = Object.entries(reactions).map(([emoji, users]) => {
      const count = Object.keys(users || {}).length;
      return count ? `<button class="reaction-btn" data-react="${context}|${contextId}|${messageId}|${emoji}" type="button">${emoji} ${count}</button>` : "";
    }).filter(Boolean);
    return items.length ? `<div class="reaction-row">${items.join("")}</div>` : "";
  }

  function renderMessageBody(message) {
    const type = message.type || "text";
    if (type === "image") {
      return `
        <a class="message-image-link" href="${escapeHtml(message.fileURL || "#")}" target="_blank" rel="noreferrer">
          <img class="message-image" src="${escapeHtml(message.fileURL || "")}" alt="${escapeHtml(message.fileName || "Imagen")}" />
        </a>
        ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ""}
      `;
    }
    if (type === "file") {
      return `
        <a class="message-file-card" href="${escapeHtml(message.fileURL || "#")}" target="_blank" rel="noreferrer">
          <strong>${escapeHtml(message.fileName || "Archivo")}</strong>
          <span>${escapeHtml(formatFileSize(message.fileSize || 0))}</span>
        </a>
        ${message.text ? `<p>${escapeHtml(message.text)}</p>` : ""}
      `;
    }
    return `<p>${escapeHtml(message.text || "")}</p>`;
  }

  function getMessageStatusLabel(status) {
    if (status === "seen") return "✔✔ visto";
    if (status === "delivered") return "✔✔ entregado";
    return "✔ enviado";
  }

  function formatFileSize(size) {
    const value = Number(size || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleChatCommand(rawText, scope) {
    const parts = String(rawText || "").trim().split(/\s+/);
    const command = String(parts.shift() || "").toLowerCase();
    if (!command.startsWith("/")) return false;
    if (!isAdmin()) {
      setStatus(`${scope}-chat-status`, "Ese comando es solo para staff.", "error");
      return true;
    }

    if (command === "/clear") {
      const targetRef = scope === "general"
        ? dbRef("chat/messages")
        : scope === "group" && state.activeGroupId
          ? dbRef(`groupChats/${state.activeGroupId}/messages`)
          : null;
      if (!targetRef) {
        setStatus(`${scope}-chat-status`, "No hay una sala valida para limpiar.", "error");
        return true;
      }
      await targetRef.remove();
      setStatus(`${scope}-chat-status`, "Mensajes eliminados.", "success");
      await logActivity("command", { command, scope });
      return true;
    }

    if (command === "/ban") {
      const targetNeedle = parts.join(" ").trim().toLowerCase();
      const targetUser = state.users.find((user) => (
        user.uid !== state.currentUser.uid &&
        (String(user.username || "").toLowerCase() === targetNeedle ||
          getFullName(user).toLowerCase() === targetNeedle)
      ));
      if (!targetUser) {
        setStatus(`${scope}-chat-status`, "No se encontro ese usuario.", "error");
        return true;
      }
      await dbRef(`users/${targetUser.uid}`)?.update({ banned: true });
      setStatus(`${scope}-chat-status`, `${targetUser.username || "Usuario"} ha sido baneado.`, "success");
      await logActivity("command", { command, scope, targetUserId: targetUser.uid });
      return true;
    }

    setStatus(`${scope}-chat-status`, "Comando no reconocido.", "error");
    return true;
  }

  function bindMessageActions(root, context, contextId) {
    root.querySelectorAll("[data-delete-message]").forEach((button) => {
      button.onclick = () => {
        const [ctx, roomId, messageId] = button.dataset.deleteMessage.split("|");
        deleteMessage(ctx, roomId, messageId);
      };
    });

    root.querySelectorAll("[data-edit-message]").forEach((button) => {
      button.onclick = () => {
        const [ctx, roomId, messageId] = button.dataset.editMessage.split("|");
        const article = button.closest(".chat-message");
        startEditMessage(article, ctx, roomId, messageId);
      };
    });

    root.querySelectorAll("[data-reaction-toggle]").forEach((button) => {
      button.onclick = () => {
        const [ctx, roomId, messageId] = button.dataset.reactionToggle.split("|");
        document.getElementById(`picker-${ctx}-${roomId || "root"}-${messageId}`)?.classList.toggle("hidden");
      };
    });

    root.querySelectorAll("[data-react]").forEach((button) => {
      button.onclick = () => {
        const [ctx, roomId, messageId, emoji] = button.dataset.react.split("|");
        toggleReaction(ctx, roomId, messageId, emoji);
      };
    });

    bindHoverCards(root);
  }

  function bindHoverCards(root = document) {
    root.querySelectorAll(".hover-user-trigger").forEach((node) => {
      node.onmouseenter = (event) => showHoverCard(event.currentTarget.dataset.hoverUser, event.currentTarget);
      node.onmouseleave = () => scheduleHideHoverCard();
    });

    const card = document.getElementById("chat-hover-card");
    if (card && !card.dataset.bound) {
      card.onmouseenter = () => {
        if (window.__hoverCardHideTimer) {
          clearTimeout(window.__hoverCardHideTimer);
        }
      };
      card.onmouseleave = hideHoverCard;
      card.dataset.bound = "true";
    }
  }

  function showHoverCard(uid, anchor) {
    const user = state.usersMap[uid];
    const card = document.getElementById("chat-hover-card");
    if (!user || !card || !anchor) return;
    const presence = getPresenceLabel(user);
    card.innerHTML = `
      <div class="user-hover-head">
        <div class="user-hover-avatar" style="color:${escapeHtml(user.profileAccent || "#2563eb")}">${escapeHtml(user.avatarEmoji || getInitials(user))}</div>
        <div>
          <strong>${escapeHtml(getFullName(user))}</strong>
          <p>@${escapeHtml(user.username || "usuario")} · ${escapeHtml(user.curso || "Sin curso")}</p>
        </div>
      </div>
      <div class="inline-meta">
        <span class="presence-chip ${presence.className}">${escapeHtml(presence.text)}</span>
        <span class="badge ${getRangeClass(user.rango)}">${escapeHtml(user.rango || "Free")}</span>
      </div>
      <div class="chat-row-actions">
        <button class="ghost-btn" data-hover-add-friend="${uid}" type="button">Añadir amigo</button>
        <button class="ghost-btn" data-hover-open-chat="${uid}" type="button">Chat</button>
      </div>
    `;

    const rect = anchor.getBoundingClientRect();
    card.style.top = `${window.scrollY + rect.bottom + 10}px`;
    card.style.left = `${window.scrollX + rect.left}px`;
    card.classList.remove("hidden");

    card.querySelector("[data-hover-add-friend]")?.addEventListener("click", () => startContact(uid));
    card.querySelector("[data-hover-open-chat]")?.addEventListener("click", () => {
      activateTab("private");
      openPrivateChat(uid);
      hideHoverCard();
    });
  }

  function scheduleHideHoverCard() {
    window.__hoverCardHideTimer = setTimeout(hideHoverCard, 120);
  }

  function hideHoverCard() {
    if (window.__hoverCardHideTimer) {
      clearTimeout(window.__hoverCardHideTimer);
      window.__hoverCardHideTimer = null;
    }
    document.getElementById("chat-hover-card")?.classList.add("hidden");
  }

  function startEditMessage(article, context, contextId, messageId) {
    const textNode = article.querySelector("p");
    if (!textNode || article.querySelector(".message-edit-form")) return;
    article.classList.add("editing");
    const currentText = textNode.textContent || "";
    const form = document.createElement("form");
    form.className = "message-edit-form";
    form.innerHTML = `
      <input type="text" value="${escapeHtml(currentText)}" />
      <button class="primary-btn" type="submit">Guardar</button>
      <button class="ghost-btn" type="button">Cancelar</button>
    `;
    article.appendChild(form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      const nextText = form.querySelector("input").value.trim();
      if (!nextText) return;
      await editMessage(context, contextId, messageId, nextText);
    };
    form.querySelector("button[type='button']").onclick = () => {
      form.remove();
      article.classList.remove("editing");
    };
  }

  async function editMessage(context, contextId, messageId, text) {
    const ref = getMessageRef(context, contextId, messageId);
    if (!ref) return;
    await ref.update({ text, editedAt: firebase.database.ServerValue.TIMESTAMP });
  }

  async function deleteMessage(context, contextId, messageId) {
    const ref = getMessageRef(context, contextId, messageId);
    if (!ref) return;
    await ref.remove();
  }

  async function toggleReaction(context, contextId, messageId, emoji) {
    const ref = getMessageRef(context, contextId, messageId);
    if (!ref) return;
    const reactionRef = ref.child(`reactions/${emoji}/${state.currentUser.uid}`);
    const snapshot = await reactionRef.once("value");
    if (snapshot.exists()) await reactionRef.remove();
    else await reactionRef.set(true);
  }

  function getMessageRef(context, contextId, messageId) {
    if (context === "general") return dbRef(`chat/messages/${messageId}`);
    if (context === "group") return dbRef(`groupChats/${contextId}/messages/${messageId}`);
    if (context === "private") return dbRef(`privateChats/${contextId}/messages/${messageId}`);
    return null;
  }

  function bindEmojiComposer(scope) {
    const toggle = document.getElementById(`${scope}-emoji-toggle`);
    const picker = document.getElementById(`${scope}-emoji-picker`);
    const input = document.getElementById(`${scope}-chat-input`);
    if (!toggle || !picker || !input) return;
    picker.innerHTML = state.emojis.map((emoji) => `<button class="emoji-choice" data-compose-emoji="${scope}|${emoji}" type="button">${emoji}</button>`).join("");
    toggle.onclick = () => picker.classList.toggle("hidden");
    picker.querySelectorAll("[data-compose-emoji]").forEach((button) => {
      button.onclick = () => {
        const [, emoji] = button.dataset.composeEmoji.split("|");
        input.value = `${input.value}${emoji}`;
        input.focus();
      };
    });
  }

  async function notifyUsersForGeneral() {
    const notificationTargets = state.users.filter((user) => user.uid !== state.currentUser.uid && user.notificationsEnabled !== false);
    if (typeof window.pushAppNotification !== "function") return;
    for (const user of notificationTargets.slice(0, 12)) {
      await window.pushAppNotification(user.uid, {
        title: "Nuevo mensaje en general",
        message: `${state.currentUser.username}: mensaje nuevo en el chat general`,
        type: "message"
      });
    }
  }

  async function notifyGroupAdmins(group, title, message) {
    if (typeof window.pushAppNotification !== "function") return;
    const adminIds = Object.keys(group.admins || {});
    for (const uid of adminIds) {
      if (uid !== state.currentUser.uid) {
        await window.pushAppNotification(uid, { title, message, type: "group" });
      }
    }
  }

  async function notifyGroupMembers(group, text) {
    if (typeof window.pushAppNotification !== "function") return;
    const memberIds = Object.keys(group.members || {});
    for (const uid of memberIds) {
      if (uid !== state.currentUser.uid) {
        await window.pushAppNotification(uid, {
          title: `Nuevo mensaje en ${group.name || "grupo"}`,
          message: `${state.currentUser.username}: ${text.slice(0, 60)}`,
          type: "message"
        });
      }
    }
  }

  function clearListeners() {
    clearTypingState();
    clearTypingPresenceListener();
    listeners.splice(0).forEach((off) => off());
    activeGroupMessagesOff = null;
    activePrivateMessagesOff = null;
  }

  function isAdmin() {
    return String(state.currentUser?.rol || "").toLowerCase() === "admin";
  }

  function isGroupMember(group, uid) {
    return Boolean(group?.members && group.members[uid]);
  }

  function isGroupAdmin(group, uid) {
    return Boolean(group?.admins && group.admins[uid]) || group?.ownerId === uid;
  }

  function canWriteGeneral() {
    const settings = state.generalSettings || {};
    if (settings.enabled === false) return { allowed: false, message: "El chat general está desactivado.", meta: "Desactivado por administración" };
    const role = String(state.currentUser?.rol || "user").toLowerCase();
    const range = String(state.currentUser?.rango || "Free").toLowerCase();
    const order = { free: 0, vip: 1, admin: 2 };
    const current = role === "admin" ? 2 : (order[range] ?? 0);
    const required = order[String(settings.minRange || "free").toLowerCase()] ?? 0;
    const mode = String(settings.writeMode || "all").toLowerCase();
    if (mode === "admin" && role !== "admin") return { allowed: false, message: "Solo admin puede escribir.", meta: "Solo admin" };
    if (mode === "vip" && role !== "admin" && range !== "vip") return { allowed: false, message: "Solo VIP o admin pueden escribir.", meta: "VIP o admin" };
    if (current < required) return { allowed: false, message: "No tienes rango suficiente.", meta: `Rango mínimo: ${settings.minRange || "Free"}` };
    return { allowed: true, message: "", meta: "Acceso según configuración global" };
  }

  function privateChatId(a, b) {
    return [a, b].sort().join("_");
  }

  function getPresenceLabel(user) {
    if (!user) {
      return { text: "Offline", className: "offline" };
    }
    if (user.invisibleMode) {
      return { text: "Invisible", className: "offline" };
    }
    const presence = state.presence[user.uid] || {};
    if (presence.online) {
      return { text: "Online", className: "online" };
    }
    if (presence.lastSeen) {
      return { text: `Activo hace ${formatRelativeTime(presence.lastSeen)}`, className: "offline" };
    }
    return { text: "Offline", className: "offline" };
  }

  function updatePrivateRoomPresence() {
    const chip = document.getElementById("private-room-presence");
    if (!chip || !state.activePrivateUserId) {
      return;
    }
    const user = state.usersMap[state.activePrivateUserId];
    const presence = getPresenceLabel(user);
    chip.textContent = presence.text;
    chip.classList.remove("hidden", "online", "offline");
    chip.classList.add("presence-chip", presence.className);
  }

  function formatRelativeTime(timestamp) {
    const diff = Math.max(0, Date.now() - Number(timestamp || 0));
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "menos de 1 min";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h`;
    const days = Math.floor(hours / 24);
    return `${days} d`;
  }

  function rollXP() {
    return Math.floor(Math.random() * 6) + 5;
  }

  function levelFromXP(xp) {
    return Math.floor(Number(xp || 0) / 100) + 1;
  }

  function getFullName(user) {
    return [user?.nombre, user?.apellido].filter(Boolean).join(" ").trim() || "Sin nombre";
  }

  function getInitials(user) {
    const base = [user?.nombre?.[0], user?.apellido?.[0]].filter(Boolean).join("").toUpperCase();
    return base || String(user?.username || "MS").slice(0, 2).toUpperCase();
  }

  function formatTime(timestamp) {
    return timestamp ? new Date(timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "Ahora";
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setStatus(id, message, type = "") {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `auth-status ${type}`.trim();
    el.textContent = message;
  }

  function setBadge(id, range) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("free", "vip", "admin", "banned");
    el.classList.add(getRangeClass(range));
  }

  function getRangeClass(range) {
    return String(range || "Free").toLowerCase() === "vip" ? "vip" : "free";
  }

  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return Array.from(document.querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
