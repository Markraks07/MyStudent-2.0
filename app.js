const firebaseConfig = {
  apiKey: "AIzaSyDe26KwLGthAsijsDE8l9ItEl21r9aD9YQ",
  authDomain: "mystudent-2-0-2badb.firebaseapp.com",
  databaseURL: "https://mystudent-2-0-2badb-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "mystudent-2-0-2badb",
  storageBucket: "mystudent-2-0-2badb.firebasestorage.app",
  messagingSenderId: "741948842953",
  appId: "1:741948842953:web:14964a8cb7da76b2177e18"
};

const firebaseSdkUrls = [
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-database-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage-compat.js"
];

let auth = null;
let db = null;
let storage = null;
let currentUser = null;
let chatQuery = null;
let chatListener = null;
let usersRef = null;
let usersListener = null;
let profileRef = null;
let profileListener = null;
let onboardingStep = 1;
let announcementsRef = null;
let announcementsListener = null;
let chatSettingsRef = null;
let chatSettingsListener = null;
let activeChatMode = "global";
let activeChatUserId = "";
let adminUsersCache = [];
let presenceRef = null;

const page = document.body.dataset.page || "index";

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  applySavedTheme();
  applySavedVisualPreferences();

  if (activeChatMode === "global") {
    const restriction = canUserWriteInGlobalChat(currentUser, await getChatSettings());
    if (!restriction.allowed) {
      setStatus(document.getElementById("chat-status"), restriction.message, "error");
      return;
    }
  }

  try {
    await loadFirebaseSdk();

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    db = firebase.database();
    storage = firebase.storage();

    if (!db) {
      throw new Error("Database no inicializada");
    }

    bindThemeToggle();

    auth.onAuthStateChanged(async (user) => {
      cleanupRealtimeListeners();

      if (!user) {
        clearPresence();
        currentUser = null;
        window.currentUser = null;
        if (page !== "index") {
          window.location.replace("index.html");
          return;
        }
        setupAuthPage();
        return;
      }

      const profile = await getUserProfile(user.uid);

      if (!profile || profile.banned) {
        await auth.signOut();
        if (page === "index") {
          setupAuthPage(profile && profile.banned ? "Tu cuenta ha sido bloqueada." : "Tu perfil no existe.", "error");
        }
        return;
      }

      currentUser = profile;
      window.currentUser = profile;
      window.appStorage = storage;
      syncVisualPreferencesFromUser(profile);
      setupPresence(user.uid, profile);
      subscribeToCurrentUser(user.uid);

      if (page === "index") {
        window.location.replace("dashboard.html");
        return;
      }

      if (profile.onboardingComplete === false && page !== "dashboard") {
        window.location.replace("dashboard.html");
        return;
      }

      safeCall(bindCommonShell, "bindCommonShell");
      safeCall(hydrateCommonUserUI, "hydrateCommonUserUI");
      safeCall(loadAnnouncementBanner, "loadAnnouncementBanner");

      if (page === "dashboard") {
        safeCall(loadDashboard, "loadDashboard");
        safeCall(setupOnboarding, "setupOnboarding");
      }

      if (page === "profile") {
        safeCall(loadProfile, "loadProfile");
      }

      if (page === "settings") {
        safeCall(loadSettings, "loadSettings");
      }

      if (page === "store") {
        safeCall(loadStore, "loadStore");
      }

      if (page === "chat") {
        safeCall(loadChat, "loadChat");
      }

      if (page === "admin") {
        safeCall(loadAdmin, "loadAdmin");
      }

      safeCall(setupNotifications, "setupNotifications");
    });
  } catch (error) {
    console.error(error);
    renderFatalState("No se pudo iniciar la aplicación. Revisa la conexión y Firebase.");
  }
}

async function loadFirebaseSdk() {
  if (typeof firebase !== "undefined") {
    return;
  }

  for (const url of firebaseSdkUrls) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
      document.head.appendChild(script);
    });
  }
}

function setupAuthPage(message = "", type = "") {
  if (page !== "index") {
    return;
  }

  const status = document.getElementById("auth-status");
  const loginView = document.getElementById("login-view");
  const registerView = document.getElementById("register-view");

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.onclick = () => {
      const mode = button.dataset.authMode;
      const isLogin = mode === "login";
      loginView.classList.toggle("hidden", !isLogin);
      registerView.classList.toggle("hidden", isLogin);

      document.querySelectorAll("[data-auth-mode]").forEach((item) => {
        item.classList.toggle("active", item.dataset.authMode === mode);
      });

      setStatus(status, "");
    };
  });

  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");

  if (loginForm) {
    loginForm.onsubmit = handleLogin;
  }

  if (registerForm) {
    registerForm.onsubmit = handleRegister;
  }

  setStatus(status, message, type);
}

async function handleLogin(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const status = document.getElementById("auth-status");

  setButtonLoading(button, true, "Entrando...");
  setStatus(status, "Validando acceso...");

  try {
    await auth.signInWithEmailAndPassword(form.email.value.trim(), form.password.value);
  } catch (error) {
    console.error(error);
    setStatus(status, getFriendlyError(error), "error");
    setButtonLoading(button, false);
  }
}

async function handleRegister(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const status = document.getElementById("auth-status");
  const data = {
    nombre: form.nombre.value.trim(),
    apellido: form.apellido.value.trim(),
    username: form.username.value.trim(),
    curso: form.curso.value.trim(),
    email: form.email.value.trim(),
    password: form.password.value,
    confirmPassword: form.confirmPassword.value
  };

  const validationError = validateRegisterData(data);
  if (validationError) {
    setStatus(status, validationError, "error");
    return;
  }

  setButtonLoading(button, true, "Creando...");
  setStatus(status, "Guardando perfil...");

  try {
    const usernameExists = await isUsernameTaken(data.username);
    if (usernameExists) {
      throw new Error("Ese username ya está en uso.");
    }

    const credentials = await auth.createUserWithEmailAndPassword(data.email, data.password);

    await db.ref(`users/${credentials.user.uid}`).set({
      nombre: data.nombre,
      apellido: data.apellido,
      username: data.username,
      usernameLower: data.username.toLowerCase(),
      curso: data.curso,
      email: data.email,
      xp: 0,
      nivel: 1,
      coins: 250,
      balance: 250,
      messagesCount: 0,
      rol: "user",
      rango: "Free",
      avatarEmoji: "MS",
      bannerColor: "#dbeafe",
      profileAccent: "#2563eb",
      banned: false,
      notificationsEnabled: true,
      invisibleMode: false,
      preferredTheme: getSavedTheme(),
      blurEffectsEnabled: getSavedBooleanPreference("mystudent-blur", true),
      animationsEnabled: getSavedBooleanPreference("mystudent-animations", true),
      compactMode: getSavedBooleanPreference("mystudent-compact", false),
      onboardingComplete: false,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });

    await credentials.user.updateProfile({ displayName: data.username });
    setStatus(status, "Cuenta creada. Entrando...", "success");
  } catch (error) {
    console.error(error);
    setStatus(status, getFriendlyError(error), "error");
    setButtonLoading(button, false);
  }
}

function bindCommonShell() {
  const logoutButton = document.getElementById("logout-button");
  if (logoutButton) {
    logoutButton.onclick = async () => {
      try {
        await auth.signOut();
      } catch (error) {
        console.error(error);
      }
    };
  }
}

function hydrateCommonUserUI() {
  if (!currentUser) {
    return;
  }

  const isAdminUser = getNormalizedRole(currentUser) === "admin";

  const title = document.getElementById("topbar-title");
  const username = document.getElementById("topbar-username");
  const range = document.getElementById("topbar-range");
  const avatar = document.getElementById("user-avatar");
  const adminLink = document.getElementById("admin-link");
  const adminChip = document.getElementById("dashboard-admin-chip");
  const profileAdminChip = document.getElementById("profile-admin-chip");

  if (title && page === "dashboard") {
    title.textContent = `Hola, ${currentUser.nombre || currentUser.username || "estudiante"}`;
  }

  if (title && page === "profile") {
    title.textContent = `Perfil de ${currentUser.nombre || currentUser.username || "usuario"}`;
  }

  if (username) {
    username.textContent = currentUser.username || "usuario";
  }

  if (range) {
    range.textContent = currentUser.rango || "Free";
  }

  if (avatar) {
    avatar.textContent = getInitials(currentUser);
  }

  if (adminLink) {
    adminLink.classList.toggle("hidden", !isAdminUser);
  }

  if (adminChip) {
    adminChip.classList.toggle("hidden", !isAdminUser);
  }

  if (profileAdminChip) {
    profileAdminChip.classList.toggle("hidden", !isAdminUser);
  }
}

function loadDashboard() {
  if (!currentUser) {
    return;
  }

  const xp = Number(currentUser.xp || 0);
  const level = getLevelFromXP(xp);
  const progress = xp % 100;

  setText("topbar-title", `Hola, ${currentUser.nombre || currentUser.username || "estudiante"}`);
  setText("user-xp", xp);
  setText("user-level", level);
  setText("user-rank-card", currentUser.rango || "Free");
  setText("user-fullname", getFullName(currentUser));
  setText("user-username", `@${currentUser.username || "usuario"}`);
  setText("user-course", currentUser.curso || "No definido");
  setText("user-role", currentUser.rol || "user");
  setText("progress-label", `Nivel ${level}`);
  setText("progress-percent", `${progress}%`);
  setText("account-email", currentUser.email || "Email");
  setText("account-status", currentUser.banned ? "Bloqueada" : "Activa");

  const progressBar = document.getElementById("progress-bar");
  if (progressBar) {
    progressBar.style.width = `${progress}%`;
  }
}

function setupOnboarding() {
  if (page !== "dashboard" || !currentUser || currentUser.onboardingComplete !== false) {
    return;
  }

  onboardingStep = 1;

  const overlay = document.getElementById("onboarding-overlay");
  const nextButton = document.getElementById("onboarding-next");
  const backButton = document.getElementById("onboarding-back");
  const profileForm = document.getElementById("onboarding-profile-form");
  const notificationsInput = document.getElementById("onboarding-notifications");
  const status = document.getElementById("onboarding-status");

  if (!overlay || !nextButton || !backButton || !profileForm || !notificationsInput) {
    return;
  }

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  profileForm.nombre.value = currentUser.nombre || "";
  profileForm.apellido.value = currentUser.apellido || "";
  profileForm.username.value = currentUser.username || "";
  profileForm.curso.value = currentUser.curso || "";
  notificationsInput.checked = currentUser.notificationsEnabled !== false;

  const currentTheme = normalizeTheme(currentUser.preferredTheme || getSavedTheme());
  setTheme(currentTheme);
  setOnboardingTheme(currentTheme);
  renderOnboardingStep();

  nextButton.onclick = async () => {
    setStatus(status, "");

    if (onboardingStep === 2) {
      const validationError = validateRegisterData({
        nombre: profileForm.nombre.value.trim(),
        apellido: profileForm.apellido.value.trim(),
        username: profileForm.username.value.trim(),
        curso: profileForm.curso.value.trim(),
        email: currentUser.email || "temp@email.com",
        password: "123456",
        confirmPassword: "123456"
      });

      if (validationError && !validationError.includes("contraseña")) {
        setStatus(status, validationError, "error");
        return;
      }

      try {
        setButtonLoading(nextButton, true, "Guardando...");
        await saveOnboardingProfile(profileForm);
      } catch (error) {
        console.error(error);
        setStatus(status, getFriendlyError(error), "error");
        setButtonLoading(nextButton, false);
        return;
      }
    }

    if (onboardingStep === 3) {
      try {
        setButtonLoading(nextButton, true, "Guardando...");
        await saveOnboardingPreferences(notificationsInput.checked);
      } catch (error) {
        console.error(error);
        setStatus(status, getFriendlyError(error), "error");
        setButtonLoading(nextButton, false);
        return;
      }
    }

    if (onboardingStep === 5) {
      try {
        setButtonLoading(nextButton, true, "Entrando...");
        await completeOnboarding();
        overlay.classList.add("hidden");
        overlay.setAttribute("aria-hidden", "true");
        return;
      } catch (error) {
        console.error(error);
        setStatus(status, getFriendlyError(error), "error");
        setButtonLoading(nextButton, false);
        return;
      }
    }

    onboardingStep += 1;
    renderOnboardingStep();
    setButtonLoading(nextButton, false);
  };

  backButton.onclick = () => {
    if (onboardingStep > 1) {
      onboardingStep -= 1;
      renderOnboardingStep();
    }
  };

  document.querySelectorAll("[data-onboarding-theme]").forEach((button) => {
    button.onclick = () => {
      const theme = button.dataset.onboardingTheme;
      setTheme(theme);
      setOnboardingTheme(theme);
    };
  });
}

function renderOnboardingStep() {
  const steps = document.querySelectorAll(".onboarding-step");
  const nextButton = document.getElementById("onboarding-next");
  const backButton = document.getElementById("onboarding-back");
  const label = document.getElementById("onboarding-step-label");
  const progressBar = document.getElementById("onboarding-progress-bar");

  steps.forEach((step) => {
    step.classList.toggle("hidden", Number(step.dataset.step) !== onboardingStep);
  });

  if (label) {
    label.textContent = `Paso ${onboardingStep} de 5`;
  }

  if (progressBar) {
    progressBar.style.width = `${onboardingStep * 20}%`;
  }

  if (backButton) {
    backButton.classList.toggle("hidden", onboardingStep === 1);
  }

  if (nextButton) {
    nextButton.textContent = onboardingStep === 5 ? "Entrar al dashboard" : "Continuar";
    nextButton.dataset.originalLabel = nextButton.textContent;
  }
}

async function saveOnboardingProfile(form) {
  const nextUsername = form.username.value.trim();
  const usernameChanged = nextUsername.toLowerCase() !== String(currentUser.username || "").toLowerCase();

  if (usernameChanged && await isUsernameTaken(nextUsername)) {
    throw new Error("Ese username ya está en uso.");
  }

  await db.ref(`users/${currentUser.uid}`).update({
    nombre: form.nombre.value.trim(),
    apellido: form.apellido.value.trim(),
    username: nextUsername,
    usernameLower: nextUsername.toLowerCase(),
    curso: form.curso.value.trim()
  });
}

async function saveOnboardingPreferences(notificationsEnabled) {
  const preferredTheme = getSavedTheme();
  await db.ref(`users/${currentUser.uid}`).update({
    notificationsEnabled,
    preferredTheme,
    blurEffectsEnabled: getSavedBooleanPreference("mystudent-blur", true),
    animationsEnabled: getSavedBooleanPreference("mystudent-animations", true),
    compactMode: getSavedBooleanPreference("mystudent-compact", false)
  });
}

async function completeOnboarding() {
  await db.ref(`users/${currentUser.uid}`).update({
    onboardingComplete: true
  });
}

function setOnboardingTheme(theme) {
  document.querySelectorAll("[data-onboarding-theme]").forEach((button) => {
    button.classList.toggle("active", button.dataset.onboardingTheme === theme);
  });
}

function loadProfile() {
  if (!currentUser) {
    return;
  }

  const xp = Number(currentUser.xp || 0);
  const level = getLevelFromXP(xp);
  const progress = xp % 100;

  setText("topbar-title", `Perfil de ${currentUser.nombre || currentUser.username || "usuario"}`);
  setText("profile-fullname", getFullName(currentUser));
  setText("profile-tagline", `@${currentUser.username || "usuario"} · ${currentUser.curso || "Curso no definido"}`);
  setText("profile-email", currentUser.email || "-");
  setText("profile-username", `@${currentUser.username || "usuario"}`);
  setText("profile-course", currentUser.curso || "-");
  setText("profile-coins", Number(currentUser.coins ?? currentUser.balance ?? 0));
  setText("profile-uid", currentUser.uid || "-");
  setText("profile-role-chip", currentUser.rol || "user");
  setText("profile-level-chip", `Nivel ${level}`);
  setText("profile-progress-label", `Nivel ${level}`);
  setText("profile-progress-percent", `${progress}%`);
  setText("profile-xp-chip", `XP ${xp}`);
  setText("profile-status-chip", currentUser.banned ? "Cuenta bloqueada" : "Cuenta activa");
  setText("profile-rank-badge", currentUser.rango || "Free");

  const avatar = document.getElementById("profile-avatar-large");
  const progressBar = document.getElementById("profile-progress-bar");
  const rankBadge = document.getElementById("profile-rank-badge");
  const banner = document.getElementById("profile-banner");
  const achievementsRoot = document.getElementById("profile-achievements");
  const customizationForm = document.getElementById("profile-customization-form");

  if (avatar) {
    avatar.textContent = currentUser.avatarEmoji || getInitials(currentUser);
    avatar.style.color = currentUser.profileAccent || "#2563eb";
  }

  if (banner) {
    banner.style.background = `linear-gradient(135deg, ${currentUser.bannerColor || "#dbeafe"}, ${currentUser.profileAccent || "#2563eb"}22)`;
  }

  if (progressBar) {
    progressBar.style.width = `${progress}%`;
  }

  updateRankBadgeClass(rankBadge, currentUser.rango);

  const editForm = document.getElementById("profile-edit-form");
  const passwordForm = document.getElementById("profile-password-form");

  if (editForm) {
    editForm.nombre.value = currentUser.nombre || "";
    editForm.apellido.value = currentUser.apellido || "";
    editForm.username.value = currentUser.username || "";
    editForm.curso.value = currentUser.curso || "";
    editForm.onsubmit = handleProfileEdit;
  }

  if (passwordForm) {
    passwordForm.onsubmit = handlePasswordChange;
  }

  if (customizationForm) {
    customizationForm.avatarEmoji.value = currentUser.avatarEmoji || "MS";
    customizationForm.bannerColor.value = currentUser.bannerColor || "#dbeafe";
    customizationForm.profileAccent.value = currentUser.profileAccent || "#2563eb";
    customizationForm.onsubmit = handleProfileCustomization;
  }

  if (achievementsRoot) {
    renderAchievements(currentUser.achievements || {}, achievementsRoot);
  }
}

function loadSettings() {
  if (!currentUser) {
    return;
  }

  setText("topbar-title", "Ajustes");

  const accountForm = document.getElementById("settings-account-form");
  const appearanceForm = document.getElementById("settings-appearance-form");
  const notificationsForm = document.getElementById("settings-notifications-form");
  const privacyForm = document.getElementById("settings-privacy-form");
  const generalForm = document.getElementById("settings-general-form");
  const passwordForm = document.getElementById("settings-password-form");

  if (accountForm) {
    accountForm.nombre.value = currentUser.nombre || "";
    accountForm.apellido.value = currentUser.apellido || "";
    accountForm.username.value = currentUser.username || "";
    accountForm.curso.value = currentUser.curso || "";
    accountForm.onsubmit = handleSettingsAccount;
  }

  if (appearanceForm) {
    appearanceForm.theme.value = normalizeTheme(currentUser.preferredTheme || getSavedTheme());
    document.getElementById("settings-blur-enabled").checked = currentUser.blurEffectsEnabled !== false;
    document.getElementById("settings-animations-enabled").checked = currentUser.animationsEnabled !== false;
    document.getElementById("settings-compact-mode").checked = currentUser.compactMode === true;
    appearanceForm.onsubmit = handleSettingsAppearance;
  }

  if (notificationsForm) {
    document.getElementById("settings-notifications-enabled").checked = currentUser.notificationsEnabled !== false;
    notificationsForm.onsubmit = handleSettingsNotifications;
  }

  if (privacyForm) {
    document.getElementById("settings-private-profile").checked = currentUser.profilePrivate === true;
    document.getElementById("settings-invisible-mode").checked = currentUser.invisibleMode === true;
    privacyForm.onsubmit = handleSettingsPrivacy;
  }

  if (generalForm) {
    document.getElementById("settings-language").value = currentUser.language || "es";
    generalForm.onsubmit = handleSettingsGeneral;
  }

  if (passwordForm) {
    passwordForm.onsubmit = handlePasswordChange;
  }
}

function loadStore() {
  if (!currentUser) {
    return;
  }

  setText("topbar-title", "Tienda");

  if (typeof currentUser.coins !== "number") {
    updateCurrentUserData({ coins: Number(currentUser.balance || 250), balance: Number(currentUser.balance || 250) }, "store-buy-status");
  }

  const productsRef = getDbRef("store/products");
  if (productsRef) {
    productsRef.on("value", (snapshot) => {
      const products = [];
      snapshot.forEach((child) => {
        const product = { id: child.key, ...child.val() };
        if (product.active !== false) {
          products.push(product);
        }
      });
      renderStoreCatalog(products);
    });
  }

  const purchasesRef = getDbRef("store/purchases");
  if (purchasesRef) {
    purchasesRef.orderByChild("uid").equalTo(currentUser.uid).on("value", (snapshot) => {
      const purchases = [];
      snapshot.forEach((child) => purchases.push({ id: child.key, ...child.val() }));
      renderStoreHistory(purchases.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)));
    });
  }

  setText("store-balance", Number(currentUser.coins ?? currentUser.balance ?? 0));
}

function renderStoreCatalog(products) {
  const root = document.getElementById("store-catalog");
  if (!root) {
    return;
  }

  root.innerHTML = products.length ? products.map((product) => `
    <article class="store-card">
      <h4>${escapeHtml(product.name || "Producto")}</h4>
      <p>${escapeHtml(product.type || "beneficio")} · ${escapeHtml(String(product.value || "-"))}</p>
      <div class="inline-meta">
        <span class="mini-chip">${Number(product.price || 0)} coins</span>
      </div>
      <div class="chat-row-actions">
        <button class="primary-btn" data-buy-product="${product.id}" type="button">Comprar</button>
      </div>
    </article>
  `).join("") : `<div class="center-note">No hay productos activos.</div>`;

  root.querySelectorAll("[data-buy-product]").forEach((button) => {
    button.onclick = () => buyStoreProduct(button.dataset.buyProduct);
  });
}

function renderStoreHistory(purchases) {
  const root = document.getElementById("store-history");
  if (!root) {
    return;
  }

  setText("store-purchase-count", purchases.length);

  root.innerHTML = purchases.length ? purchases.map((purchase) => `
    <div class="admin-history-item">
      <strong>${escapeHtml(purchase.productName || "Compra")}</strong>
      <div class="muted">${escapeHtml(purchase.productType || "beneficio")} · ${escapeHtml(formatTime(purchase.createdAt))}</div>
    </div>
  `).join("") : `<div class="center-note">Todavía no has comprado nada.</div>`;
}

async function buyStoreProduct(productId) {
  const productRef = getDbRef(`store/products/${productId}`);
  const purchaseRef = getDbRef("store/purchases");
  const userRef = getDbRef(`users/${currentUser.uid}`);

  if (!productRef || !purchaseRef || !userRef) {
    setStatus(document.getElementById("store-buy-status"), "Database no inicializada", "error");
    return;
  }

  const snapshot = await productRef.once("value");
  if (!snapshot.exists()) {
    setStatus(document.getElementById("store-buy-status"), "Producto no disponible.", "error");
    return;
  }

  const product = snapshot.val() || {};
  const balance = Number(currentUser.coins ?? currentUser.balance ?? 0);
  const price = Number(product.price || 0);

  if (balance < price) {
    setStatus(document.getElementById("store-buy-status"), "Saldo insuficiente.", "error");
    return;
  }

  const updates = { coins: balance - price, balance: balance - price };

  if (String(product.type || "").toLowerCase() === "xp") {
    updates.xp = Number(currentUser.xp || 0) + Number(product.value || 0);
    updates.nivel = getLevelFromXP(updates.xp);
  }

  if (String(product.type || "").toLowerCase() === "nivel") {
    updates.nivel = Number(currentUser.nivel || 1) + Number(product.value || 0);
  }

  if (String(product.type || "").toLowerCase() === "vip") {
    updates.rango = "VIP";
  }

  if (String(product.type || "").toLowerCase() === "avatar") {
    updates.avatarEmoji = String(product.value || "✨");
  }

  if (String(product.type || "").toLowerCase() === "banner") {
    updates.bannerColor = String(product.value || "#dbeafe");
  }

  if (String(product.type || "").toLowerCase() === "color") {
    updates.profileAccent = String(product.value || "#2563eb");
  }

  await userRef.update(updates);
  await purchaseRef.push({
    uid: currentUser.uid,
    username: currentUser.username,
    productId,
    productName: product.name || "Producto",
    productType: product.type || "beneficio",
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });

  setStatus(document.getElementById("store-buy-status"), "Compra realizada con éxito.", "success");
  await evaluateAchievements({ ...currentUser, ...updates }, "store");
  if (typeof window.pushAppNotification === "function") {
    window.pushAppNotification(currentUser.uid, {
      title: "Compra realizada",
      message: `Has comprado ${product.name || "un producto"}`,
      type: "store"
    });
  }
}

async function handleProfileEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await saveEditableProfile({
    nombre: form.nombre.value.trim(),
    apellido: form.apellido.value.trim(),
    username: form.username.value.trim(),
    curso: form.curso.value.trim()
  }, "profile-edit-status", form.querySelector("button"));
}

async function handleProfileCustomization(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    avatarEmoji: form.avatarEmoji.value,
    bannerColor: form.bannerColor.value,
    profileAccent: form.profileAccent.value
  };

  if (String(currentUser.rango || "").toLowerCase() !== "vip") {
    payload.profileAccent = "#2563eb";
  }

  await updateCurrentUserData(payload, "profile-customization-status", form.querySelector("button"));
}

async function handlePasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const passwordInput = form.querySelector("input[type='password']");
  const statusId = page === "settings" ? "settings-password-status" : "profile-password-status";

  if (!passwordInput.value || passwordInput.value.length < 6) {
    setStatus(document.getElementById(statusId), "La contraseña debe tener al menos 6 caracteres.", "error");
    return;
  }

  try {
    await auth.currentUser.updatePassword(passwordInput.value);
    setStatus(document.getElementById(statusId), "Contraseña actualizada.", "success");
    form.reset();
  } catch (error) {
    console.error(error);
    setStatus(document.getElementById(statusId), getFriendlyError(error), "error");
  }
}

async function handleSettingsAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await saveEditableProfile({
    nombre: form.nombre.value.trim(),
    apellido: form.apellido.value.trim(),
    username: form.username.value.trim(),
    curso: form.curso.value.trim()
  }, "settings-account-status", form.querySelector("button"));
}

async function handleSettingsAppearance(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const theme = normalizeTheme(form.theme.value);
  const blurEffectsEnabled = document.getElementById("settings-blur-enabled").checked;
  const animationsEnabled = document.getElementById("settings-animations-enabled").checked;
  const compactMode = document.getElementById("settings-compact-mode").checked;

  await updateCurrentUserData({
    preferredTheme: theme,
    blurEffectsEnabled,
    animationsEnabled,
    compactMode
  }, "settings-appearance-status", form.querySelector("button"));

  persistVisualPreferences({
    theme,
    blurEffectsEnabled,
    animationsEnabled,
    compactMode
  });
}

async function handleSettingsNotifications(event) {
  event.preventDefault();
  await updateCurrentUserData({
    notificationsEnabled: document.getElementById("settings-notifications-enabled").checked
  }, "settings-notifications-status", event.currentTarget.querySelector("button"));
}

async function handleSettingsPrivacy(event) {
  event.preventDefault();
  await updateCurrentUserData({
    profilePrivate: document.getElementById("settings-private-profile").checked,
    invisibleMode: document.getElementById("settings-invisible-mode").checked
  }, "settings-privacy-status", event.currentTarget.querySelector("button"));
  if (auth?.currentUser && currentUser) {
    setupPresence(auth.currentUser.uid, {
      ...currentUser,
      profilePrivate: document.getElementById("settings-private-profile").checked,
      invisibleMode: document.getElementById("settings-invisible-mode").checked
    });
  }
}

async function handleSettingsGeneral(event) {
  event.preventDefault();
  await updateCurrentUserData({
    language: document.getElementById("settings-language").value.trim() || "es"
  }, "settings-general-status", event.currentTarget.querySelector("button"));
}

function loadChat() {
  if (!currentUser) {
    return;
  }

  if (document.getElementById("general-chat-form")) {
    return;
  }

  setText("topbar-title", "Chat");
  setText("chat-user-rank", currentUser.rango || "Free");
  setText("chat-identity-rank", currentUser.rango || "Free");
  setText("chat-identity-username", `@${currentUser.username || "usuario"}`);

  updateRankBadgeClass(document.getElementById("chat-user-rank"), currentUser.rango);
  updateRankBadgeClass(document.getElementById("chat-identity-rank"), currentUser.rango);

  const form = document.getElementById("chat-form");
  if (form) {
    form.onsubmit = handleSendMessage;
  }

  document.getElementById("global-chat-button")?.addEventListener("click", () => switchChatRoom("global"));
  loadChatContacts(new URLSearchParams(window.location.search).get("dm") || "");
  subscribeToChatSettings();

  const dmUserId = new URLSearchParams(window.location.search).get("dm");
  if (dmUserId) {
    switchChatRoom("dm", dmUserId);
    return;
  }

  chatQuery = db.ref("chat/messages").orderByChild("createdAt").limitToLast(100);
  chatListener = chatQuery.on("value", (snapshot) => {
    const messages = [];
    snapshot.forEach((child) => {
      messages.push({ id: child.key, ...child.val() });
    });
    renderChatMessages(messages);
  });
}

async function handleSendMessage(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const text = form.message.value.trim();

  if (!text || !currentUser) {
    return;
  }

  setButtonLoading(button, true, "Enviando...");

  try {
    const payload = {
      uid: currentUser.uid,
      username: currentUser.username,
      rango: currentUser.rango || "Free",
      text,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    if (activeChatMode === "dm" && activeChatUserId) {
      const dmRef = getDbRef(getDmPath(currentUser.uid, activeChatUserId));
      if (!dmRef) {
        throw new Error("Database no inicializada");
      }

      await dmRef.push({
        ...payload,
        members: [currentUser.uid, activeChatUserId]
      });
    } else {
      const messagesRef = getDbRef("chat/messages");
      if (!messagesRef) {
        throw new Error("Database no inicializada");
      }

      await messagesRef.push(payload);
    }

    const xpGain = getRandomXP();
    await addXP(xpGain);

    form.reset();
    form.message.focus();
  } catch (error) {
    console.error(error);
    alert(getFriendlyError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

function renderChatMessages(messages) {
  const container = document.getElementById("chat-messages");
  if (!container) {
    return;
  }

  if (!messages.length) {
    container.innerHTML = `<div class="center-note">Aún no hay mensajes. Escribe el primero.</div>`;
    return;
  }

  container.innerHTML = messages
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .map((message) => `
        <article class="chat-message ${message.uid === currentUser.uid ? "own" : ""}">
        <div class="chat-meta">
          <span class="badge ${getRangeBadgeClass(message.rango)}">${escapeHtml(message.rango || "Free")}</span>
          <strong>${escapeHtml(message.username || "usuario")}</strong>
          <span>${escapeHtml(formatTime(message.createdAt))}</span>
        </div>
        <p>${escapeHtml(message.text || "")}</p>
      </article>
    `)
    .join("");

  container.scrollTop = container.scrollHeight;
}

function renderMessages(messages) {
  renderChatMessages(Array.isArray(messages) ? messages : []);
}

function loadAdmin() {
  if (!currentUser || getNormalizedRole(currentUser) !== "admin") {
    window.location.replace("dashboard.html");
    return;
  }

  setText("topbar-title", "Panel de administración");
  setText("admin-identity", `@${currentUser.username || "admin"}`);
  bindAdminTabs();
  bindAdminStaticActions();
  loadAdminUsers();
  loadAdminChatSection();
  loadStoreSection();
  loadAnnouncementsSection();
}

function renderAdminStats(users) {
  const totalUsers = users.length;
  const vipUsers = users.filter((user) => String(user.rango || "").toLowerCase() === "vip").length;
  const adminUsers = users.filter((user) => String(user.rol || "").toLowerCase() === "admin").length;
  const bannedUsers = users.filter((user) => Boolean(user.banned)).length;

  setText("stat-total-users", totalUsers);
  setText("stat-vip-users", vipUsers);
  setText("stat-admin-users", adminUsers);
  setText("stat-banned-users", bannedUsers);
  setText("admin-total-chip", `Usuarios ${totalUsers}`);
  setText("admin-vip-chip", `VIP ${vipUsers}`);
  setText("admin-banned-chip", `Baneados ${bannedUsers}`);
}

function bindAdminTabs() {
  document.querySelectorAll("[data-admin-section]").forEach((button) => {
    button.onclick = () => {
      document.querySelectorAll("[data-admin-section]").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".admin-section").forEach((section) => section.classList.add("hidden"));
      button.classList.add("active");
      document.getElementById(`admin-section-${button.dataset.adminSection}`)?.classList.remove("hidden");
    };
  });
}

function bindAdminStaticActions() {
  document.getElementById("admin-user-search")?.addEventListener("input", () => renderAdvancedAdminTable(adminUsersCache));
  document.getElementById("admin-global-search")?.addEventListener("input", () => renderAdminGlobalSearch());
  document.getElementById("admin-user-form")?.addEventListener("submit", handleAdminUserSave);
  document.getElementById("admin-reset-xp")?.addEventListener("click", handleAdminResetXP);
  document.getElementById("admin-open-dm")?.addEventListener("click", handleAdminOpenDM);
  document.getElementById("admin-chat-settings-form")?.addEventListener("submit", handleAdminChatSettingsSave);
  document.getElementById("admin-chat-clean-form")?.addEventListener("submit", handleAdminChatClean);
  document.getElementById("admin-chat-inspector-form")?.addEventListener("submit", handleAdminChatInspector);
  document.getElementById("store-product-form")?.addEventListener("submit", handleStoreProductSave);
  document.getElementById("announcement-form")?.addEventListener("submit", handleAnnouncementSave);
}

function loadAdminUsers() {
  usersRef = getDbRef("users");
  if (!usersRef) {
    return;
  }

  usersListener = usersRef.on("value", (snapshot) => {
    adminUsersCache = [];
    snapshot.forEach((child) => {
      adminUsersCache.push({ uid: child.key, ...child.val() });
    });
    renderAdminStats(adminUsersCache);
    renderAdvancedAdminTable(adminUsersCache);
    renderAdminGlobalSearch();
  });
}

function renderAdminGlobalSearch() {
  const root = document.getElementById("admin-global-search-results");
  const query = String(document.getElementById("admin-global-search")?.value || "").trim().toLowerCase();
  if (!root) {
    return;
  }

  if (!query) {
    root.innerHTML = `<div class="center-note">Empieza a escribir para buscar.</div>`;
    return;
  }

  const userResults = adminUsersCache
    .filter((user) => `${getFullName(user)} ${user.username || ""} ${user.curso || ""}`.toLowerCase().includes(query))
    .slice(0, 6)
    .map((user) => `
      <div class="admin-history-item">
        <strong>${escapeHtml(getFullName(user))}</strong>
        <div class="muted">Usuario · @${escapeHtml(user.username || "usuario")} · ${escapeHtml(user.curso || "Sin curso")}</div>
      </div>
    `);

  const groupResults = (window.__adminGroupsCache || [])
    .filter((group) => `${group.name || ""} ${group.description || ""}`.toLowerCase().includes(query))
    .slice(0, 6)
    .map((group) => `
      <div class="admin-history-item">
        <strong>${escapeHtml(group.name || "Grupo")}</strong>
        <div class="muted">Grupo · ${escapeHtml(group.privacy || "public")} · ${escapeHtml(group.description || "Sin descripcion")}</div>
      </div>
    `);

  const productResults = (window.__adminStoreProductsCache || [])
    .filter((product) => `${product.name || ""} ${product.type || ""} ${product.value || ""}`.toLowerCase().includes(query))
    .slice(0, 6)
    .map((product) => `
      <div class="admin-history-item">
        <strong>${escapeHtml(product.name || "Producto")}</strong>
        <div class="muted">Tienda · ${escapeHtml(product.type || "-")} · ${Number(product.price || 0)} coins</div>
      </div>
    `);

  const results = [...userResults, ...groupResults, ...productResults];
  root.innerHTML = results.length ? results.join("") : `<div class="center-note">No hay resultados para esa busqueda.</div>`;
}

function renderAdvancedAdminTable(users) {
  const tbody = document.getElementById("users-table-body");
  if (!tbody) {
    return;
  }

  const query = String(document.getElementById("admin-user-search")?.value || "").toLowerCase().trim();
  const filtered = users.filter((user) => {
    const text = `${getFullName(user)} ${user.username || ""} ${user.curso || ""}`.toLowerCase();
    return !query || text.includes(query);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted">No hay resultados.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((user) => {
    const isBanned = Boolean(user.banned);
    const isVip = String(user.rango || "").toLowerCase() === "vip";
    return `
      <tr>
        <td>${escapeHtml(getFullName(user))}</td>
        <td>@${escapeHtml(user.username || "sin-username")}</td>
        <td>${escapeHtml(user.curso || "-")}</td>
        <td>${Number(user.xp || 0)}</td>
        <td>${Number(user.nivel || 1)}</td>
        <td>${escapeHtml(user.rol || "user")}</td>
        <td><span class="badge ${getRangeBadgeClass(user.rango)}">${escapeHtml(user.rango || "Free")}</span></td>
        <td><span class="badge ${isBanned ? "banned" : "free"}">${isBanned ? "Baneado" : "Activo"}</span></td>
        <td>
          <div class="admin-actions">
            <button class="admin-action neutral" data-user-action="select" data-uid="${user.uid}" type="button">Ver</button>
            <button class="admin-action vip" data-user-action="toggle-vip" data-uid="${user.uid}" type="button">${isVip ? "Quitar VIP" : "VIP"}</button>
            <button class="admin-action ban" data-user-action="toggle-ban" data-uid="${user.uid}" type="button">${isBanned ? "Desbanear" : "Banear"}</button>
            <button class="admin-action neutral" data-user-action="delete" data-uid="${user.uid}" type="button">Borrar</button>
            <button class="admin-action neutral" data-user-action="dm" data-uid="${user.uid}" type="button">Chat</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-user-action]").forEach((button) => {
    button.onclick = handleAdvancedAdminAction;
  });
}

function renderAdminTable(users) {
  const body = document.getElementById("users-table-body");
  if (!body) {
    return;
  }

  if (!users.length) {
    body.innerHTML = `<tr><td colspan="9" class="muted">No hay usuarios registrados.</td></tr>`;
    return;
  }

  body.innerHTML = users
    .sort((a, b) => getFullName(a).localeCompare(getFullName(b), "es", { sensitivity: "base" }))
    .map((user) => {
      const isVip = String(user.rango || "").toLowerCase() === "vip";
      const isBanned = Boolean(user.banned);
      const isSelf = currentUser && user.uid === currentUser.uid;

      return `
        <tr>
          <td>${escapeHtml(getFullName(user))}</td>
          <td>@${escapeHtml(user.username || "sin-username")}</td>
          <td>${escapeHtml(user.curso || "-")}</td>
          <td>${Number(user.xp || 0)}</td>
          <td>${Number(user.nivel || 1)}</td>
          <td>${escapeHtml(user.rol || "user")}</td>
          <td><span class="badge ${getRangeBadgeClass(user.rango)}">${escapeHtml(user.rango || "Free")}</span></td>
          <td><span class="badge ${isBanned ? "banned" : "free"}">${isBanned ? "Baneado" : "Activo"}</span></td>
          <td>
            <div class="admin-actions">
              <button class="admin-action vip ${isVip ? "neutral" : ""}" data-action="vip" data-uid="${user.uid}" ${isVip || isBanned ? "disabled" : ""}>
                ${isVip ? "Ya VIP" : "Hacer VIP"}
              </button>
              <button class="admin-action ban" data-action="ban" data-uid="${user.uid}" ${isBanned || isSelf ? "disabled" : ""}>
                ${isSelf ? "Tu cuenta" : isBanned ? "Baneado" : "Banear"}
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  body.querySelectorAll("[data-action]").forEach((button) => {
    button.onclick = handleAdminAction;
  });
}

async function handleAdminAction(event) {
  const button = event.currentTarget;
  const { action, uid } = button.dataset;

  setButtonLoading(button, true, action === "vip" ? "Actualizando..." : "Aplicando...");

  try {
    if (action === "vip") {
      await db.ref(`users/${uid}`).update({ rango: "VIP" });
    }

    if (action === "ban") {
      await db.ref(`users/${uid}`).update({ banned: true });
    }
  } catch (error) {
    console.error(error);
    alert(getFriendlyError(error));
  } finally {
    setButtonLoading(button, false);
  }
}

async function getUserProfile(uid) {
  if (!uid) {
    return null;
  }

  const userRef = getDbRef(`users/${uid}`);
  if (!userRef) {
    return null;
  }

  const snapshot = await userRef.once("value");
  return snapshot.exists() ? { uid, ...snapshot.val() } : null;
}

function subscribeToCurrentUser(uid) {
  if (!uid) {
    return;
  }

  profileRef = getDbRef(`users/${uid}`);
  if (!profileRef) {
    return;
  }

  profileListener = profileRef.on("value", (snapshot) => {
    if (!snapshot.exists()) {
      auth.signOut();
      return;
    }

    const updatedUser = { uid, ...snapshot.val() };
    if (updatedUser.banned) {
      auth.signOut();
      return;
    }

    currentUser = updatedUser;
    window.currentUser = updatedUser;
    syncVisualPreferencesFromUser(updatedUser);
    if (auth?.currentUser?.uid) {
      setupPresence(auth.currentUser.uid, updatedUser);
    }
    safeCall(hydrateCommonUserUI, "hydrateCommonUserUI");

    if (page === "dashboard") {
      safeCall(loadDashboard, "loadDashboard");
    }

    if (page === "profile") {
      safeCall(loadProfile, "loadProfile");
    }

    if (page === "settings") {
      safeCall(loadSettings, "loadSettings");
    }

    if (page === "store") {
      safeCall(loadStore, "loadStore");
    }

    if (page === "chat") {
      setText("chat-user-rank", updatedUser.rango || "Free");
      setText("chat-identity-rank", updatedUser.rango || "Free");
      updateRankBadgeClass(document.getElementById("chat-user-rank"), updatedUser.rango);
      updateRankBadgeClass(document.getElementById("chat-identity-rank"), updatedUser.rango);
    }

    if (page === "admin" && getNormalizedRole(updatedUser) !== "admin") {
      window.location.replace("dashboard.html");
    }
  });
}

async function isUsernameTaken(username) {
  const usersRef = getDbRef("users");
  if (!usersRef) {
    return false;
  }

  const snapshot = await usersRef.orderByChild("usernameLower").equalTo(username.toLowerCase()).once("value");
  return snapshot.exists();
}

function getDbRef(path) {
  if (!db) {
    console.error("Database no inicializada");
    return null;
  }

  return db.ref(path);
}

async function loadChatContacts(preselectedDm = "") {
  const container = document.getElementById("dm-users-list");
  if (!container) {
    return;
  }

  const usersRef = getDbRef("users");
  if (!usersRef) {
    container.innerHTML = `<div class="center-note">No se pudo cargar la lista de usuarios.</div>`;
    return;
  }

  const snapshot = await usersRef.once("value");
  const users = [];
  snapshot.forEach((child) => {
    const user = { uid: child.key, ...child.val() };
    if (user.uid !== currentUser.uid && !user.banned) {
      users.push(user);
    }
  });

  container.innerHTML = users.map((user) => `
    <button class="chat-thread ${preselectedDm === user.uid ? "active" : ""}" data-dm-user="${user.uid}" type="button">
      ${escapeHtml(getFullName(user))}<br><span class="muted">@${escapeHtml(user.username || "usuario")}</span>
    </button>
  `).join("");

  container.querySelectorAll("[data-dm-user]").forEach((button) => {
    button.onclick = () => switchChatRoom("dm", button.dataset.dmUser);
  });
}

function switchChatRoom(mode, userId = "") {
  activeChatMode = mode;
  activeChatUserId = userId;

  document.querySelectorAll(".chat-thread").forEach((item) => item.classList.remove("active"));

  if (mode === "global") {
    document.getElementById("global-chat-button")?.classList.add("active");
    setText("chat-room-title", "Canal global");
    setText("chat-room-subtitle", "Mensajes en tiempo real.");
    history.replaceState(null, "", "chat.html");
  } else {
    document.querySelector(`[data-dm-user="${userId}"]`)?.classList.add("active");
    setText("chat-room-title", "Chat privado");
    setText("chat-room-subtitle", "Conversación directa.");
    history.replaceState(null, "", `chat.html?dm=${userId}`);
  }

  if (chatQuery && chatListener) {
    chatQuery.off("value", chatListener);
  }

  const chatBaseRef = mode === "global" ? getDbRef("chat/messages") : getDbRef(getDmPath(currentUser.uid, userId));
  if (!chatBaseRef) {
    renderMessages([]);
    return;
  }

  chatQuery = chatBaseRef.orderByChild("createdAt").limitToLast(100);

  chatListener = chatQuery.on("value", (snapshot) => {
    const messages = [];
    snapshot.forEach((child) => {
      messages.push({ id: child.key, ...child.val() });
    });
    renderMessages(messages);
  });
}

function subscribeToChatSettings() {
  chatSettingsRef = getDbRef("platform/chatSettings");
  if (!chatSettingsRef) {
    return;
  }
  chatSettingsListener = chatSettingsRef.on("value", (snapshot) => {
    const input = document.getElementById("chat-input");
    const button = document.querySelector("#chat-form button");
    const status = document.getElementById("chat-status");
    const restriction = canUserWriteInGlobalChat(currentUser, snapshot.val() || {});

    if (activeChatMode === "global") {
      if (input) {
        input.disabled = !restriction.allowed;
      }
      if (button) {
        button.disabled = !restriction.allowed;
      }
      setStatus(status, restriction.allowed ? "" : restriction.message, restriction.allowed ? "" : "error");
    }
  });
}

async function getChatSettings() {
  const settingsRef = getDbRef("platform/chatSettings");
  if (!settingsRef) {
    return {};
  }

  try {
    const snapshot = await settingsRef.once("value");
    if (!snapshot.exists()) {
      console.warn("No hay chatSettings en DB");
      return {};
    }

    return snapshot.val() || {};
  } catch (error) {
    console.error("Error al leer chatSettings:", error);
    return {};
  }
}

function canUserWriteInGlobalChat(user, settings) {
  if (settings.enabled === false) {
    return { allowed: false, message: "El chat global está desactivado." };
  }

  const role = getNormalizedRole(user);
  const range = String(user?.rango || "Free").toLowerCase();
  const mode = String(settings.writeMode || "all").toLowerCase();
  const minRange = String(settings.minRange || "free").toLowerCase();
  const order = { free: 0, vip: 1, admin: 2 };
  const currentOrder = role === "admin" ? 2 : (order[range] ?? 0);
  const requiredOrder = order[minRange] ?? 0;

  if (mode === "admin" && role !== "admin") {
    return { allowed: false, message: "Solo admin puede escribir ahora mismo." };
  }

  if (mode === "vip" && role !== "admin" && range !== "vip") {
    return { allowed: false, message: "Solo VIP o admin pueden escribir ahora mismo." };
  }

  if (currentOrder < requiredOrder) {
    return { allowed: false, message: `Necesitas rango ${settings.minRange || "Free"} o superior.` };
  }

  return { allowed: true, message: "" };
}

function getDmPath(uidA, uidB) {
  return `privateChats/${[uidA, uidB].sort().join("_")}/messages`;
}

async function addXP(amount) {
  if (!currentUser || !amount || amount < 1) {
    return;
  }

  const userRef = getDbRef(`users/${currentUser.uid}`);
  if (!userRef) {
    return;
  }

  const previousLevel = getLevelFromXP(Number(currentUser.xp || 0));

  const transactionResult = await userRef.transaction((userData) => {
    if (!userData) {
      return userData;
    }

    const currentXP = Number(userData.xp || 0);
    const nextXP = currentXP + amount;
    const nextLevel = getLevelFromXP(nextXP);
    const nextCoins = Number(userData.coins ?? userData.balance ?? 0) + Math.max(1, Math.floor(amount / 2));

    return {
      ...userData,
      xp: nextXP,
      nivel: nextLevel,
      coins: nextCoins,
      balance: nextCoins
    };
  });

  if (!transactionResult.committed || !transactionResult.snapshot.exists()) {
    return;
  }

  const updatedUser = {
    uid: currentUser.uid,
    ...transactionResult.snapshot.val()
  };

  currentUser = updatedUser;
  window.currentUser = updatedUser;

  if (getLevelFromXP(updatedUser.xp) > previousLevel) {
    alert("¡Subiste de nivel!");
  }
  await evaluateAchievements(updatedUser, "xp");
}

async function saveEditableProfile(data, statusId, button) {
  const validationError = validateRegisterData({
    ...data,
    email: currentUser.email || "temp@email.com",
    password: "123456",
    confirmPassword: "123456"
  });

  if (validationError && !validationError.includes("contraseña")) {
    setStatus(document.getElementById(statusId), validationError, "error");
    return;
  }

  if (String(currentUser.username || "").toLowerCase() !== data.username.toLowerCase() && await isUsernameTaken(data.username)) {
    setStatus(document.getElementById(statusId), "Ese username ya está en uso.", "error");
    return;
  }

  await updateCurrentUserData({
    ...data,
    usernameLower: data.username.toLowerCase()
  }, statusId, button);
}

async function updateCurrentUserData(payload, statusId, button) {
  try {
    if (button) {
      setButtonLoading(button, true, "Guardando...");
    }

    const userRef = getDbRef(`users/${currentUser.uid}`);
    if (!userRef) {
      throw new Error("Database no inicializada");
    }

    await userRef.update(payload);
    setStatus(document.getElementById(statusId), "Cambios guardados.", "success");
  } catch (error) {
    console.error(error);
    setStatus(document.getElementById(statusId), getFriendlyError(error), "error");
  } finally {
    if (button) {
      setButtonLoading(button, false);
    }
  }
}

async function evaluateAchievements(user = currentUser, source = "") {
  if (!user?.uid) {
    return;
  }

  const achievementsRef = getDbRef(`achievements/${user.uid}`);
  const userRef = getDbRef(`users/${user.uid}`);
  if (!achievementsRef || !userRef) {
    return;
  }

  const snapshot = await achievementsRef.once("value");
  const existing = snapshot.val() || {};
  const next = {};

  if (Number(user.messagesCount || 0) >= 1 && !existing.first_message) {
    next.first_message = { title: "Primer mensaje", createdAt: firebase.database.ServerValue.TIMESTAMP };
  }

  if (Number(user.messagesCount || 0) >= 100 && !existing.hundred_messages) {
    next.hundred_messages = { title: "100 mensajes", createdAt: firebase.database.ServerValue.TIMESTAMP };
  }

  if (Number(user.nivel || 1) >= 5 && !existing.level_5) {
    next.level_5 = { title: "Nivel 5", createdAt: firebase.database.ServerValue.TIMESTAMP };
  }

  if (!Object.keys(next).length) {
    return;
  }

  await achievementsRef.update(next);
  await userRef.update({ achievements: { ...existing, ...Object.fromEntries(Object.entries(next).map(([key, value]) => [key, { title: value.title }])) } });

  const latest = Object.values(next)[0];
  if (typeof window.pushAppNotification === "function" && latest?.title) {
    window.pushAppNotification(user.uid, {
      title: "Logro desbloqueado",
      message: latest.title,
      type: "achievement"
    });
  }
}

function renderAchievements(achievements, root) {
  if (!root) {
    return;
  }

  const items = Object.values(achievements || {});
  root.innerHTML = items.length
    ? items.map((item) => `<span class="mini-chip">${escapeHtml(item.title || "Logro")}</span>`).join("")
    : `<span class="mini-chip">Aun no tienes logros</span>`;
}

function validateRegisterData(data) {
  if (!data.nombre || !data.apellido || !data.username || !data.curso || !data.email || !data.password || !data.confirmPassword) {
    return "Completa todos los campos.";
  }

  if (data.username.length < 3) {
    return "El username debe tener al menos 3 caracteres.";
  }

  if (/\s/.test(data.username)) {
    return "El username no puede contener espacios.";
  }

  if (data.password.length < 6) {
    return "La contraseña debe tener al menos 6 caracteres.";
  }

  if (data.password !== data.confirmPassword) {
    return "Las contraseñas no coinciden.";
  }

  return "";
}

function bindThemeToggle() {
  const button = document.getElementById("theme-toggle");
  if (!button) {
    return;
  }

  refreshThemeToggleLabel();
  button.onclick = () => {
    const nextTheme = getNextTheme(getSavedTheme());
    setTheme(nextTheme);
    setOnboardingTheme(nextTheme);
  };
}

function setupNotifications() {
  if (!currentUser) {
    return;
  }

  const toggle = document.getElementById("notifications-toggle");
  const dropdown = document.getElementById("notifications-dropdown");
  const count = document.getElementById("notifications-count");
  const ref = getDbRef(`notifications/${currentUser.uid}`);

  if (!toggle || !dropdown || !count || !ref) {
    return;
  }

  toggle.onclick = async () => {
    dropdown.classList.toggle("hidden");
    if (!dropdown.classList.contains("hidden")) {
      await markNotificationsAsRead();
    }
  };

  const listener = ref.limitToLast(30).on("value", (snapshot) => {
    const notifications = [];
    snapshot.forEach((child) => notifications.push({ id: child.key, ...child.val() }));
    notifications.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    renderNotifications(notifications);
  });

  const off = () => ref.off("value", listener);
  if (!window.__appExtraListeners) {
    window.__appExtraListeners = [];
  }
  window.__appExtraListeners.push(off);
}

function renderNotifications(notifications) {
  const dropdown = document.getElementById("notifications-dropdown");
  const count = document.getElementById("notifications-count");
  if (!dropdown || !count) {
    return;
  }

  const unread = notifications.filter((item) => !item.read).length;
  count.textContent = unread;
  count.classList.toggle("hidden", unread === 0);

  dropdown.innerHTML = notifications.length ? notifications.map((item) => `
    <div class="notif-item ${item.read ? "" : "unread"}">
      <strong>${escapeHtml(item.title || "Notificación")}</strong>
      <div class="muted">${escapeHtml(item.message || "")}</div>
      <div class="inline-meta">
        <span class="mini-chip">${escapeHtml(formatTime(item.createdAt))}</span>
      </div>
    </div>
  `).join("") : `<div class="center-note">No tienes notificaciones.</div>`;
}

async function markNotificationsAsRead() {
  const ref = getDbRef(`notifications/${currentUser.uid}`);
  if (!ref) {
    return;
  }

  const snapshot = await ref.once("value");
  const updates = {};
  snapshot.forEach((child) => {
    const item = child.val() || {};
    if (!item.read) {
      updates[`${child.key}/read`] = true;
    }
  });
  if (Object.keys(updates).length) {
    await ref.update(updates);
  }
}

function pushAppNotification(uid, payload) {
  const ref = getDbRef(`notifications/${uid}`);
  if (!ref) {
    return Promise.resolve();
  }

  return ref.push({
    title: payload.title || "Notificación",
    message: payload.message || "",
    type: payload.type || "system",
    read: false,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });
}

window.pushAppNotification = pushAppNotification;
window.getAppStorage = () => storage;

function setupPresence(uid, profile = currentUser) {
  if (!db || !uid) {
    return;
  }

  presenceRef = db.ref(`presence/${uid}`);
  const connectedRef = db.ref(".info/connected");
  connectedRef.off();
  connectedRef.on("value", (snapshot) => {
    if (!snapshot.val() || !presenceRef) {
      return;
    }

    presenceRef.onDisconnect().set({
      online: false,
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    });

    presenceRef.set({
      online: profile?.invisibleMode ? false : true,
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    });
  });
}

function clearPresence() {
  if (presenceRef) {
    presenceRef.set({
      online: false,
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    }).catch(() => { });
  }
}

function loadAnnouncementBanner() {
  const banner = document.getElementById("announcement-banner");
  if (!banner) {
    return;
  }

  const ref = getDbRef("platform/announcements");
  if (!ref) {
    banner.classList.add("hidden");
    return;
  }

  announcementsRef = ref.orderByChild("active").equalTo(true);
  announcementsListener = announcementsRef.on("value", (snapshot) => {
    const items = [];
    snapshot.forEach((child) => {
      items.push({ id: child.key, ...child.val() });
    });

    const latest = items.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
    if (!latest) {
      banner.classList.add("hidden");
      banner.innerHTML = "";
      return;
    }

    banner.classList.remove("hidden");
    banner.innerHTML = `<strong>${escapeHtml(latest.title || "Aviso")}</strong><span>${escapeHtml(latest.message || "")}</span>`;
  });
}

function getSavedTheme() {
  return normalizeTheme(localStorage.getItem("mystudent-theme") || "light");
}

function getThemeLabel(theme) {
  if (normalizeTheme(theme) === "dark") {
    return "Oscuro";
  }
  if (normalizeTheme(theme) === "glass") {
    return "Liquid";
  }
  return "Claro";
}

function applySavedTheme() {
  const theme = getSavedTheme();
  document.documentElement.setAttribute("data-theme", theme);
  document.body.classList.remove("light-theme", "dark-theme", "glass-theme");
  document.body.classList.add(`${theme}-theme`);
}

function refreshThemeToggleLabel() {
  const button = document.getElementById("theme-toggle");
  if (button) {
    button.textContent = `Tema: ${getThemeLabel(getSavedTheme())}`;
  }
}

function normalizeTheme(theme) {
  const value = String(theme || "").trim().toLowerCase();
  if (value === "dusk") {
    return "dark";
  }
  if (value === "dark" || value === "glass") {
    return value;
  }
  return "light";
}

function getNextTheme(theme) {
  const current = normalizeTheme(theme);
  if (current === "light") {
    return "dark";
  }
  if (current === "dark") {
    return "glass";
  }
  return "light";
}

function getSavedBooleanPreference(key, fallback) {
  const value = localStorage.getItem(key);
  if (value === null) {
    return fallback;
  }
  return value === "true";
}

function applySavedVisualPreferences() {
  document.body.classList.toggle("reduced-motion", !getSavedBooleanPreference("mystudent-animations", true));
  document.body.classList.toggle("compact-mode", getSavedBooleanPreference("mystudent-compact", false));
  document.body.classList.toggle("reduced-blur", !getSavedBooleanPreference("mystudent-blur", true));
}

function persistVisualPreferences({ theme, blurEffectsEnabled, animationsEnabled, compactMode }) {
  localStorage.setItem("mystudent-theme", normalizeTheme(theme));
  localStorage.setItem("mystudent-blur", String(blurEffectsEnabled !== false));
  localStorage.setItem("mystudent-animations", String(animationsEnabled !== false));
  localStorage.setItem("mystudent-compact", String(compactMode === true));
  applySavedTheme();
  applySavedVisualPreferences();
  refreshThemeToggleLabel();
}

function setTheme(theme) {
  persistVisualPreferences({
    theme,
    blurEffectsEnabled: getSavedBooleanPreference("mystudent-blur", true),
    animationsEnabled: getSavedBooleanPreference("mystudent-animations", true),
    compactMode: getSavedBooleanPreference("mystudent-compact", false)
  });
}

function syncVisualPreferencesFromUser(user) {
  if (!user) {
    applySavedTheme();
    applySavedVisualPreferences();
    refreshThemeToggleLabel();
    return;
  }

  persistVisualPreferences({
    theme: user.preferredTheme || getSavedTheme(),
    blurEffectsEnabled: user.blurEffectsEnabled !== false,
    animationsEnabled: user.animationsEnabled !== false,
    compactMode: user.compactMode === true
  });
}

function fillAdminUserForm(user) {
  if (!user) {
    return;
  }

  setInputValue("admin-edit-uid", user.uid);
  setInputValue("admin-edit-name", user.nombre || "");
  setInputValue("admin-edit-lastname", user.apellido || "");
  setInputValue("admin-edit-username", user.username || "");
  setInputValue("admin-edit-course", user.curso || "");
  setInputValue("admin-edit-role", user.rol || "user");
  setInputValue("admin-edit-range", user.rango || "Free");
  setInputValue("admin-edit-xp", Number(user.xp || 0));
  setInputValue("admin-edit-level", Number(user.nivel || 1));
}

async function handleAdvancedAdminAction(event) {
  const { userAction, uid } = event.currentTarget.dataset;
  const user = adminUsersCache.find((item) => item.uid === uid);
  if (!user) {
    return;
  }

  if (userAction === "select") fillAdminUserForm(user);
  if (userAction === "dm") window.location.href = `chat.html?dm=${uid}`;
  if (userAction === "toggle-vip") await db.ref(`users/${uid}`).update({ rango: String(user.rango || "").toLowerCase() === "vip" ? "Free" : "VIP" });
  if (userAction === "toggle-ban") await db.ref(`users/${uid}`).update({ banned: !user.banned });
  if (userAction === "delete" && confirm("Se eliminará el perfil del usuario de la base de datos.")) {
    await db.ref(`users/${uid}`).remove();
  }
}

async function handleAdminUserSave(event) {
  event.preventDefault();
  const uid = document.getElementById("admin-edit-uid")?.value;
  const nextUsername = document.getElementById("admin-edit-username")?.value.trim();
  const targetUser = adminUsersCache.find((user) => user.uid === uid);
  if (!uid || !targetUser) {
    return;
  }

  if (String(targetUser.username || "").toLowerCase() !== nextUsername.toLowerCase() && await isUsernameTaken(nextUsername)) {
    setStatus(document.getElementById("admin-user-form-status"), "Ese username ya está en uso.", "error");
    return;
  }

  await db.ref(`users/${uid}`).update({
    nombre: document.getElementById("admin-edit-name").value.trim(),
    apellido: document.getElementById("admin-edit-lastname").value.trim(),
    username: nextUsername,
    usernameLower: nextUsername.toLowerCase(),
    curso: document.getElementById("admin-edit-course").value.trim(),
    rol: document.getElementById("admin-edit-role").value.trim() || "user",
    rango: document.getElementById("admin-edit-range").value.trim() || "Free",
    xp: Number(document.getElementById("admin-edit-xp").value || 0),
    nivel: Number(document.getElementById("admin-edit-level").value || 1)
  });

  setStatus(document.getElementById("admin-user-form-status"), "Usuario actualizado.", "success");
}

async function handleAdminResetXP() {
  const uid = document.getElementById("admin-edit-uid")?.value;
  if (!uid) {
    return;
  }

  await db.ref(`users/${uid}`).update({ xp: 0, nivel: 1 });
  setStatus(document.getElementById("admin-user-form-status"), "XP y nivel reseteados.", "success");
}

function handleAdminOpenDM() {
  const uid = document.getElementById("admin-edit-uid")?.value;
  if (uid) {
    window.location.href = `chat.html?dm=${uid}`;
  }
}

function loadAdminChatSection() {
  const settingsRef = getDbRef("platform/chatSettings");
  const messagesRef = getDbRef("chat/messages");
  const groupsRef = getDbRef("groups");

  if (settingsRef) {
    settingsRef.once("value").then((snapshot) => {
      const settings = snapshot.val() || {};
      setCheckboxValue("chat-enabled", settings.enabled !== false);
      setInputValue("chat-min-range", settings.minRange || "Free");
      setInputValue("chat-write-mode", settings.writeMode || "all");
    });
  }

  if (!messagesRef) {
    return;
  }

  messagesRef.orderByChild("createdAt").limitToLast(50).on("value", (snapshot) => {
    const history = [];
    snapshot.forEach((child) => history.push({ id: child.key, ...child.val() }));
    const root = document.getElementById("admin-chat-history");
    if (!root) {
      return;
    }

    root.innerHTML = history.length ? history.reverse().map((message) => `
      <div class="admin-history-item">
        <strong>${escapeHtml(message.username || "usuario")}</strong>
        <div class="muted">${escapeHtml(message.text || "")}</div>
        <div class="inline-meta">
          <span class="mini-chip">${escapeHtml(formatTime(message.createdAt))}</span>
          <button class="admin-action ban" data-delete-message="${message.id}" type="button">Eliminar</button>
        </div>
      </div>
    `).join("") : `<div class="center-note">No hay mensajes.</div>`;

    root.querySelectorAll("[data-delete-message]").forEach((button) => {
      button.onclick = async () => db.ref(`chat/messages/${button.dataset.deleteMessage}`).remove();
    });
  });

  if (groupsRef) {
    groupsRef.on("value", (snapshot) => {
      const groups = [];
      snapshot.forEach((child) => groups.push({ id: child.key, ...child.val() }));
      window.__adminGroupsCache = groups;
      renderAdminGlobalSearch();
    });
  }
}

async function handleAdminChatSettingsSave(event) {
  event.preventDefault();
  const settingsRef = getDbRef("platform/chatSettings");
  if (!settingsRef) {
    setStatus(document.getElementById("admin-chat-settings-status"), "Database no inicializada", "error");
    return;
  }

  await settingsRef.set({
    enabled: document.getElementById("chat-enabled").checked,
    minRange: document.getElementById("chat-min-range").value.trim() || "Free",
    writeMode: document.getElementById("chat-write-mode").value.trim() || "all"
  });
  setStatus(document.getElementById("admin-chat-settings-status"), "Configuración guardada.", "success");
}

async function handleAdminChatClean(event) {
  event.preventDefault();
  const status = document.getElementById("admin-chat-clean-status");
  const messagesRef = getDbRef("chat/messages");
  if (!messagesRef) {
    setStatus(status, "Database no inicializada", "error");
    return;
  }

  const days = Math.max(1, Number(document.getElementById("chat-clean-days")?.value || 30));
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const snapshot = await messagesRef.once("value");
  const updates = {};
  let removed = 0;

  snapshot.forEach((child) => {
    const message = child.val() || {};
    if (Number(message.createdAt || 0) && Number(message.createdAt) < cutoff) {
      updates[child.key] = null;
      removed += 1;
    }
  });

  if (removed) {
    await messagesRef.update(updates);
  }

  setStatus(status, removed ? `${removed} mensajes eliminados.` : "No habia mensajes que limpiar.", removed ? "success" : "");
}

async function handleAdminChatInspector(event) {
  event.preventDefault();
  const inputA = document.getElementById("inspect-user-a");
  const inputB = document.getElementById("inspect-user-b");
  const root = document.getElementById("admin-chat-inspector-results");
  const status = document.getElementById("admin-chat-inspector-status");
  if (!inputA || !inputB || !root) {
    return;
  }

  const userA = resolveAdminInspectorUser(inputA.value.trim());
  const userB = resolveAdminInspectorUser(inputB.value.trim());

  if (!userA || !userB) {
    setStatus(status, "No se encontraron los dos usuarios.", "error");
    return;
  }

  const chatRef = getDbRef(`privateChats/${[userA.uid, userB.uid].sort().join("_")}/messages`);
  if (!chatRef) {
    setStatus(status, "Database no inicializada", "error");
    return;
  }

  const snapshot = await chatRef.orderByChild("createdAt").limitToLast(100).once("value");
  const messages = [];
  snapshot.forEach((child) => messages.push({ id: child.key, ...child.val() }));

  root.innerHTML = messages.length ? messages.map((message) => `
    <div class="admin-history-item">
      <strong>${escapeHtml(message.username || "usuario")}</strong>
      <div class="muted">${escapeHtml(message.text || "")}</div>
      <div class="inline-meta">
        <span class="mini-chip">${escapeHtml(formatTime(message.createdAt))}</span>
        <button class="admin-action ban" data-admin-delete-private="${[userA.uid, userB.uid].sort().join("_")}|${message.id}" type="button">Eliminar</button>
      </div>
    </div>
  `).join("") : `<div class="center-note">No hay mensajes entre esos usuarios.</div>`;

  root.querySelectorAll("[data-admin-delete-private]").forEach((button) => {
    button.onclick = async () => {
      const [chatId, messageId] = button.dataset.adminDeletePrivate.split("|");
      const ref = getDbRef(`privateChats/${chatId}/messages/${messageId}`);
      if (ref) {
        await ref.remove();
        button.closest(".admin-history-item")?.remove();
      }
    };
  });

  setStatus(status, `Mostrando conversación entre ${userA.username} y ${userB.username}.`, "success");
}

function resolveAdminInspectorUser(value) {
  const needle = value.toLowerCase();
  return adminUsersCache.find((user) => user.uid === value || String(user.username || "").toLowerCase() === needle) || null;
}

function loadStoreSection() {
  const productsRef = getDbRef("store/products");
  const purchasesRef = getDbRef("store/purchases");

  if (productsRef) {
    productsRef.on("value", (snapshot) => {
      const products = [];
      snapshot.forEach((child) => products.push({ id: child.key, ...child.val() }));
      window.__adminStoreProductsCache = products;
      renderAdminGlobalSearch();
      const root = document.getElementById("store-products-list");
      if (!root) {
        return;
      }

      root.innerHTML = products.length ? products.map((product) => `
      <div class="admin-history-item">
        <strong>${escapeHtml(product.name || "Producto")}</strong>
        <div class="muted">${escapeHtml(product.type || "-")} · ${escapeHtml(String(product.value || "-"))}</div>
        <div class="inline-meta">
          <span class="mini-chip">€ ${Number(product.price || 0)}</span>
          <span class="badge ${product.active === false ? "banned" : "free"}">${product.active === false ? "Inactivo" : "Activo"}</span>
          <button class="admin-action neutral" data-toggle-product="${product.id}" type="button">${product.active === false ? "Activar" : "Desactivar"}</button>
          <button class="admin-action ban" data-delete-product="${product.id}" type="button">Eliminar</button>
        </div>
      </div>
    `).join("") : `<div class="center-note">No hay productos.</div>`;

      root.querySelectorAll("[data-toggle-product]").forEach((button) => {
        button.onclick = async () => {
          const target = getDbRef(`store/products/${button.dataset.toggleProduct}`);
          if (!target) {
            return;
          }
          await target.update({ active: button.textContent.trim() === "Activar" });
        };
      });

      root.querySelectorAll("[data-delete-product]").forEach((button) => {
        button.onclick = async () => {
          const productRef = getDbRef(`store/products/${button.dataset.deleteProduct}`);
          if (productRef) {
            await productRef.remove();
          }
        };
      });
    });
  }

  if (!purchasesRef) {
    return;
  }

  purchasesRef.limitToLast(30).on("value", (snapshot) => {
    const purchases = [];
    snapshot.forEach((child) => purchases.push({ id: child.key, ...child.val() }));
    const root = document.getElementById("store-purchases-list");
    if (!root) {
      return;
    }

    root.innerHTML = purchases.length ? purchases.reverse().map((purchase) => `
      <div class="admin-history-item">
        <strong>${escapeHtml(purchase.username || "usuario")}</strong>
        <div class="muted">${escapeHtml(purchase.productName || "Compra")} · ${escapeHtml(formatTime(purchase.createdAt))}</div>
      </div>
    `).join("") : `<div class="center-note">Sin compras registradas.</div>`;
  });
}

async function handleStoreProductSave(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const productsRef = getDbRef("store/products");
  if (!productsRef) {
    setStatus(document.getElementById("store-product-status"), "Database no inicializada", "error");
    return;
  }

  await productsRef.push({
    name: document.getElementById("store-product-name").value.trim(),
    type: document.getElementById("store-product-type").value.trim(),
    price: Number(document.getElementById("store-product-price").value || 0),
    value: document.getElementById("store-product-value").value.trim(),
    active: document.getElementById("store-product-active").checked,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });
  form.reset();
  setCheckboxValue("store-product-active", true);
  setStatus(document.getElementById("store-product-status"), "Producto guardado.", "success");
}

function loadAnnouncementsSection() {
  const announcementsRef = getDbRef("platform/announcements");
  if (!announcementsRef) {
    return;
  }

  announcementsRef.limitToLast(20).on("value", (snapshot) => {
    const announcements = [];
    snapshot.forEach((child) => announcements.push({ id: child.key, ...child.val() }));
    const root = document.getElementById("announcements-list");
    if (!root) {
      return;
    }

    root.innerHTML = announcements.length ? announcements.reverse().map((announcement) => `
      <div class="admin-history-item">
        <strong>${escapeHtml(announcement.title || "Anuncio")}</strong>
        <div class="muted">${escapeHtml(announcement.message || "")}</div>
        <div class="inline-meta">
          <span class="badge ${announcement.active === false ? "banned" : "free"}">${announcement.active === false ? "Oculto" : "Visible"}</span>
          <button class="admin-action ban" data-delete-announcement="${announcement.id}" type="button">Eliminar</button>
        </div>
      </div>
    `).join("") : `<div class="center-note">Sin anuncios.</div>`;

    root.querySelectorAll("[data-delete-announcement]").forEach((button) => {
      button.onclick = async () => {
        const announcementRef = getDbRef(`platform/announcements/${button.dataset.deleteAnnouncement}`);
        if (announcementRef) {
          await announcementRef.remove();
        }
      };
    });
  });
}

async function handleAnnouncementSave(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const announcementsRef = getDbRef("platform/announcements");
  if (!announcementsRef) {
    setStatus(document.getElementById("announcement-status"), "Database no inicializada", "error");
    return;
  }

  await announcementsRef.push({
    title: document.getElementById("announcement-title").value.trim(),
    message: document.getElementById("announcement-message").value.trim(),
    active: document.getElementById("announcement-active").checked,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });
  form.reset();
  setCheckboxValue("announcement-active", true);
  setStatus(document.getElementById("announcement-status"), "Anuncio publicado.", "success");
}

function cleanupRealtimeListeners() {
  if (chatQuery && chatListener) {
    chatQuery.off("value", chatListener);
  }

  if (usersRef && usersListener) {
    usersRef.off("value", usersListener);
  }

  if (profileRef && profileListener) {
    profileRef.off("value", profileListener);
  }

  if (announcementsRef && announcementsListener) {
    announcementsRef.off("value", announcementsListener);
  }

  if (chatSettingsRef && chatSettingsListener) {
    chatSettingsRef.off("value", chatSettingsListener);
  }

  if (window.__appExtraListeners) {
    window.__appExtraListeners.forEach((off) => {
      try {
        off();
      } catch (error) {
        console.error(error);
      }
    });
    window.__appExtraListeners = [];
  }

  chatQuery = null;
  chatListener = null;
  usersRef = null;
  usersListener = null;
  profileRef = null;
  profileListener = null;
  announcementsRef = null;
  announcementsListener = null;
  chatSettingsRef = null;
  chatSettingsListener = null;
}

function updateRankBadgeClass(element, range) {
  if (!element) {
    return;
  }

  element.classList.remove("free", "vip", "admin", "banned");
  element.classList.add(getRangeBadgeClass(range));
}

function getRangeBadgeClass(range) {
  return String(range || "Free").toLowerCase() === "vip" ? "vip" : "free";
}

function getNormalizedRole(user) {
  return String(user?.rol || "user").toLowerCase().trim();
}

function getLevelFromXP(xp) {
  return Math.floor(Number(xp || 0) / 100) + 1;
}

function getRandomXP() {
  return Math.floor(Math.random() * 6) + 5;
}

function getFullName(user) {
  return [user.nombre, user.apellido].filter(Boolean).join(" ").trim() || "Sin nombre";
}

function getInitials(user) {
  const initials = getFullName(user)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  return initials || "MS";
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "Ahora";
  }

  return new Date(timestamp).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function setStatus(element, message, type = "") {
  if (!element) {
    return;
  }

  element.className = `auth-status ${type}`.trim();
  element.textContent = message;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function setInputValue(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.value = value;
  }
}

function setCheckboxValue(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.checked = Boolean(value);
  }
}

function setButtonLoading(button, loading, text = "") {
  if (!button) {
    return;
  }

  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = button.textContent.trim();
  }

  button.disabled = loading;
  button.textContent = loading ? text : button.dataset.originalLabel;
}

function getFriendlyError(error) {
  const code = error && error.code ? error.code : "";
  const map = {
    "auth/email-already-in-use": "Ese email ya está registrado.",
    "auth/invalid-email": "El email no es válido.",
    "auth/user-disabled": "Esta cuenta ha sido desactivada.",
    "auth/user-not-found": "No existe ninguna cuenta con ese email.",
    "auth/wrong-password": "La contraseña es incorrecta.",
    "auth/invalid-credential": "Las credenciales no son válidas.",
    "auth/weak-password": "La contraseña es demasiado débil.",
    PERMISSION_DENIED: "No tienes permisos suficientes en la base de datos."
  };

  return map[code] || error.message || "Se produjo un error inesperado.";
}

function renderFatalState(message) {
  document.body.innerHTML = `
    <main class="loading-screen">
      <section class="loading-card">
        <h1>MyStudent</h1>
        <p>${escapeHtml(message)}</p>
      </section>
    </main>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeCall(fn, label) {
  try {
    fn();
  } catch (error) {
    console.error(`Error in ${label}:`, error);
  }
}

let currentTicketId = null;

/* =========================
   🎫 USER - CREAR TICKET
========================= */
document.getElementById("ticket-form")?.addEventListener("submit", function (e) {
  e.preventDefault();

  const title = document.getElementById("ticket-title").value;
  const desc = document.getElementById("ticket-desc").value;
  const category = document.getElementById("ticket-category").value;

  const user = firebase.auth().currentUser;
  if (!user) return;

  const ref = firebase.database().ref("tickets").push();

  ref.set({
    title,
    description: desc,
    category,
    userId: user.uid,
    status: "open",
    createdAt: Date.now()
  });

  const statusText = document.getElementById("ticket-status-text");
  if (statusText) statusText.innerText = "Ticket creado ✔";
});


/* =========================
   📋 USER - LISTAR TICKETS
========================= */
function loadMyTickets() {
  const user = firebase.auth().currentUser;
  if (!user) return;

  firebase.database().ref("tickets")
    .orderByChild("userId")
    .equalTo(user.uid)
    .on("value", (snapshot) => {

      const data = snapshot.val();
      const container = document.getElementById("my-tickets");

      if (!container) return;

      container.innerHTML = "";

      if (!data) return;

      Object.keys(data).forEach(id => {
        const t = data[id];

        const div = document.createElement("div");
        div.className = "ticket-item";

        div.innerHTML = `
          <b>${t.title}</b>
          <span>${t.status}</span>
        `;

        div.onclick = () => openTicketUser(id);

        container.appendChild(div);
      });

    });
}


/* =========================
   💬 USER - ABRIR TICKET
========================= */
function openTicketUser(ticketId) {
  currentTicketId = ticketId;
  loadTicketChat(ticketId);
}


/* =========================
   🛠️ ADMIN - LISTAR TICKETS
========================= */
function loadAdminTickets() {
  const user = firebase.auth().currentUser;
  if (!user) return;

  // comprobar si es admin
  firebase.database().ref("admins/" + user.uid).once("value").then(snap => {
    if (!snap.exists()) return;

    firebase.database().ref("tickets").on("value", (snapshot) => {

      const data = snapshot.val();
      const container = document.getElementById("admin-tickets-list");

      if (!container) return;

      container.innerHTML = "";

      if (!data) return;

      Object.keys(data).forEach(id => {
        const t = data[id];

        const div = document.createElement("div");

        div.className = "ticket-item";

        div.innerHTML = `
          <b>${t.title}</b>
          <span>${t.status}</span>
        `;

        div.onclick = () => openTicketAdmin(id);

        container.appendChild(div);
      });

    });
  });
}


/* =========================
   👀 ADMIN - ABRIR TICKET
========================= */
function openTicketAdmin(ticketId) {
  currentTicketId = ticketId;

  firebase.database().ref(`tickets/${ticketId}`).once("value")
    .then(snapshot => {
      const t = snapshot.val();

      const titleEl = document.getElementById("ticket-title");
      const infoEl = document.getElementById("ticket-info");
      const statusSelect = document.getElementById("ticket-status-select");

      if (titleEl) titleEl.innerText = t?.title || "";
      if (infoEl) infoEl.innerText = t?.description || "";
      if (statusSelect) statusSelect.value = t?.status || "open";

      loadTicketChat(ticketId);
      loadAdminsSelect();
    });
}


/* =========================
   💬 CHAT TICKET (AMBOS)
========================= */
function loadTicketChat(ticketId) {
  firebase.database().ref(`tickets/${ticketId}/messages`)
    .off(); // evitar duplicados

  firebase.database().ref(`tickets/${ticketId}/messages`)
    .on("value", (snapshot) => {

      const data = snapshot.val();
      const container = document.getElementById("ticket-chat");

      if (!container) return;

      container.innerHTML = "";

      if (!data) return;

      Object.values(data).forEach(msg => {
        const div = document.createElement("div");

        div.className = "chat-msg";

        div.innerHTML = `<b>${msg.sender}</b>: ${msg.text}`;

        container.appendChild(div);
      });

    });
}


/* =========================
   ✉️ ADMIN - ENVIAR MENSAJE
========================= */
function sendAdminMessage() {
  const text = document.getElementById("admin-message")?.value;
  const user = firebase.auth().currentUser;

  if (!currentTicketId || !text) return;

  firebase.database().ref(`tickets/${currentTicketId}/messages`).push({
    text: text,
    sender: user.uid,
    createdAt: Date.now()
  });

  const input = document.getElementById("admin-message");
  if (input) input.value = "";
}


/* =========================
   👤 ADMIN - CARGAR ADMINS
========================= */
function loadAdminsSelect() {
  const select = document.getElementById("assign-admin");
  if (!select) return;

  firebase.database().ref("admins").once("value").then(snapshot => {
    const data = snapshot.val();

    select.innerHTML = "";

    if (!data) return;

    Object.keys(data).forEach(uid => {
      const option = document.createElement("option");
      option.value = uid;
      option.innerText = uid;
      select.appendChild(option);
    });
  });
}


/* =========================
   🛠️ ADMIN - ASIGNAR ADMIN
========================= */
function assignSelectedAdmin() {
  const adminUid = document.getElementById("assign-admin")?.value;

  if (!currentTicketId || !adminUid) return;

  firebase.database().ref(`tickets/${currentTicketId}`).update({
    assignedTo: adminUid
  });
}


/* =========================
   ✅ ADMIN - CAMBIAR ESTADO
========================= */
function updateStatus() {
  const status = document.getElementById("ticket-status-select")?.value;

  if (!currentTicketId || !status) return;

  firebase.database().ref(`tickets/${currentTicketId}`).update({
    status: status
  });
}
