// User-facing copy for the various dialogs / project UI. Keys are prefixed with
// `dialog.` and merged into the locale dictionaries at runtime so `t("dialog.*")`
// resolves alongside the core nav/account strings. English is the source/fallback.

type LocaleMessages = Record<"en" | "zh" | "fr", Record<string, string>>;

export const dialogsMessages: LocaleMessages = {
  en: {
    // Quick Notes dialog
    "dialog.quickNotes.title": "Quick Notes",
    "dialog.quickNotes.description":
      "Jot down anything for this project. Bring a note into the conversation when you're ready to discuss it.",
    "dialog.quickNotes.empty": "No notes yet.",
    "dialog.quickNotes.lastDiscussed": "Last discussed {when}",
    "dialog.quickNotes.notDiscussed": "Not discussed yet",
    "dialog.quickNotes.sandbox": "Sandbox",
    "dialog.quickNotes.deleteNote": "Delete note",
    "dialog.quickNotes.placeholder": "Write a quick note…",
    "dialog.quickNotes.add": "Add",
    "dialog.quickNotes.noteLabel": "Quick note",
    "dialog.quickNotes.loadedToast": "Note loaded into the conversation.",

    // Project search dialog
    "dialog.search.title": "Search",
    "dialog.search.description":
      "Search across this project's truths, candidates, and ideas.",
    "dialog.search.placeholder": "Search the project…",
    "dialog.search.button": "Search",
    "dialog.search.rankedByRelevance": "Ranked by relevance",
    "dialog.search.keywordMatches": "Keyword matches",
    "dialog.search.prompt": "Type a query and press Enter.",
    "dialog.search.noMatches": "No matches found.",
    "dialog.search.failedToast": "Search failed.",
    "dialog.search.overlayMessage": "Searching the project",
    "dialog.search.overlaySubmessage":
      "Looking across truths, candidates, and ideas",

    // Create project modal
    "dialog.createProject.somethingWentWrong": "Something went wrong.",
    "dialog.createProject.untitledProject": "Untitled project",
    "dialog.createProject.inputTitle": "Start with what you have",
    "dialog.createProject.inputDescription":
      "Paste notes, drop a pitch deck, or describe the project. ZENO extracts goals, constraints, and open questions for you to confirm.",
    "dialog.createProject.inputPlaceholder":
      "Describe the project, or paste anything you have...",
    "dialog.createProject.titleLabel": "Project title",
    "dialog.createProject.titlePlaceholder": "Name your project",
    "dialog.createProject.attachFiles": "Attach files",
    "dialog.createProject.creatingWorkspace": "Creating workspace...",
    "dialog.createProject.startBlank": "Start blank",
    "dialog.createProject.extract": "Extract →",
    "dialog.createProject.extracting": "Extracting decisions and topics...",
    "dialog.createProject.emptyExtraction":
      "We couldn't extract any decisions from that text. Add more context, or start blank.",
    "dialog.createProject.back": "← Back",
    "dialog.createProject.startBlankArrow": "Start blank →",
    "dialog.createProject.renameTopic": "Rename topic",
    "dialog.createProject.whatIsType": "What is a {type}?",
    "dialog.createProject.groupedPrefix":
      "ZENO grouped {count} decisions into ",
    "dialog.createProject.topicSingular": "topic",
    "dialog.createProject.topicPlural": "topics",
    "dialog.createProject.groupedSuffix":
      ". Rename topics, uncheck items, or move them before committing.",
    "dialog.createProject.selectAtLeastOneToast":
      "Select at least one extracted item before creating the workspace.",
    "dialog.createProject.selectAtLeastOneButton": "Select at least one item",
    "dialog.createProject.confirmSummary":
      "Confirm {checked} in {topics} topics →",
    "dialog.createProject.extractFailed":
      "Couldn't extract — try again or start blank.",

    // Project card
    "dialog.projectCard.deletedToast": "Project deleted.",
    "dialog.projectCard.deleteFailedToast": "Failed to delete project.",
    "dialog.projectCard.actionsFor": "Actions for {name}",
    "dialog.projectCard.deleteProject": "Delete project",
    "dialog.projectCard.confirmTitle": "Delete this project?",
    "dialog.projectCard.confirmDescription":
      "This permanently deletes “{name}” and all of its judgments, truths, and history. This can’t be undone.",
    "dialog.projectCard.cancel": "Cancel",
    "dialog.projectCard.delete": "Delete",
    "dialog.projectCard.topicSingular": "topic",
    "dialog.projectCard.topicPlural": "topics",

    // Project API key dialog
    "dialog.apiKey.never": "Never",
    "dialog.apiKey.trigger": "MCP & API Keys",
    "dialog.apiKey.title": "MCP Access",
    "dialog.apiKey.description":
      "Generate project-bound API keys for external coding agents. Each key can read this project's truth, write routine truth directly, and route high-impact changes to review.",
    "dialog.apiKey.currentProject": "Current project",
    "dialog.apiKey.mcpEndpoint": "MCP endpoint",
    "dialog.apiKey.copyUrl": "Copy URL",
    "dialog.apiKey.endpointHint":
      "Use this URL as the MCP server endpoint and send the generated key as a Bearer token.",
    "dialog.apiKey.labelPlaceholder":
      "Key label (optional, e.g. Claude Code · Laptop)",
    "dialog.apiKey.generateKey": "Generate Key",
    "dialog.apiKey.storageHint":
      "Keys are shown once. We store only a SHA-256 hash, never the raw token.",
    "dialog.apiKey.newKeyGenerated": "New key generated",
    "dialog.apiKey.newKeyHint":
      "Copy this token now. It will not be visible again after you close this dialog.",
    "dialog.apiKey.shownOnce": "shown once",
    "dialog.apiKey.copyKey": "Copy key",
    "dialog.apiKey.existingKeys": "Existing keys",
    "dialog.apiKey.loading": "Loading API keys...",
    "dialog.apiKey.noKeys": "No API keys yet for this project.",
    "dialog.apiKey.untitledKey": "Untitled key",
    "dialog.apiKey.revoked": "Revoked",
    "dialog.apiKey.active": "Active",
    "dialog.apiKey.created": "Created: {date}",
    "dialog.apiKey.lastUsed": "Last used: {date}",
    "dialog.apiKey.revoke": "Revoke",
    "dialog.apiKey.footer":
      "Revoked keys return 401 immediately. Each key is bound to exactly one project.",
    "dialog.apiKey.generatedToast":
      "API key generated. Copy it now — it won't be shown again.",
    "dialog.apiKey.createFailedToast": "Failed to create API key.",
    "dialog.apiKey.revokedToast": "API key revoked.",
    "dialog.apiKey.revokeFailedToast": "Failed to revoke API key.",
    "dialog.apiKey.loadFailedToast": "Failed to load API keys.",
    "dialog.apiKey.clipboardUnavailableToast":
      "Clipboard is unavailable in this browser.",
    "dialog.apiKey.copyFailedToast": "Failed to copy to clipboard.",
    "dialog.apiKey.mcpCopiedToast": "MCP endpoint copied to clipboard.",
    "dialog.apiKey.keyCopiedToast": "API key copied to clipboard.",

    // Login form
    "dialog.login.supabaseMissingToast":
      "Supabase environment variables are missing. Add the public URL and anon key first.",
    "dialog.login.accountCreatedToast": "Account created.",
    "dialog.login.accountCreatedConfirmToast":
      "Account created. If email confirmation is enabled in Supabase, confirm the email before signing in.",
    "dialog.login.authFailedToast": "Authentication failed.",
    "dialog.login.signIn": "Sign in",
    "dialog.login.createAccount": "Create account",
    "dialog.login.email": "Email",
    "dialog.login.emailPlaceholder": "you@example.com",
    "dialog.login.password": "Password",
    "dialog.login.passwordPlaceholder": "At least 6 characters",
    "dialog.login.supabaseConfigHint":
      "Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to enable authentication.",

    // Project sidebar — new topic dialog + account fallback
    "dialog.sidebar.newTopicTitle": "New topic",
    "dialog.sidebar.newTopicDescription":
      "Start a blank topic for a specific decision or question.",
    "dialog.sidebar.newTopicPlaceholder": "Topic name",
    "dialog.sidebar.create": "Create",
    "dialog.sidebar.authenticatedUser": "Authenticated user",
    "dialog.sidebar.createTopicFailedToast": "Failed to create topic.",
  },
  zh: {
    // Quick Notes dialog
    "dialog.quickNotes.title": "速记",
    "dialog.quickNotes.description":
      "随手记下与该项目相关的任何内容。准备好讨论时，把笔记带入对话即可。",
    "dialog.quickNotes.empty": "还没有笔记。",
    "dialog.quickNotes.lastDiscussed": "上次讨论于 {when}",
    "dialog.quickNotes.notDiscussed": "尚未讨论",
    "dialog.quickNotes.sandbox": "沙盒",
    "dialog.quickNotes.deleteNote": "删除笔记",
    "dialog.quickNotes.placeholder": "写一条速记…",
    "dialog.quickNotes.add": "添加",
    "dialog.quickNotes.noteLabel": "速记",
    "dialog.quickNotes.loadedToast": "笔记已载入对话。",

    // Project search dialog
    "dialog.search.title": "搜索",
    "dialog.search.description": "在本项目的真相、候选项与想法中搜索。",
    "dialog.search.placeholder": "搜索项目…",
    "dialog.search.button": "搜索",
    "dialog.search.rankedByRelevance": "按相关度排序",
    "dialog.search.keywordMatches": "关键词匹配",
    "dialog.search.prompt": "输入查询并按回车。",
    "dialog.search.noMatches": "未找到匹配项。",
    "dialog.search.failedToast": "搜索失败。",
    "dialog.search.overlayMessage": "正在搜索项目",
    "dialog.search.overlaySubmessage": "在真相、候选项与想法中查找",

    // Create project modal
    "dialog.createProject.somethingWentWrong": "出错了。",
    "dialog.createProject.untitledProject": "未命名项目",
    "dialog.createProject.inputTitle": "从现有内容开始",
    "dialog.createProject.inputDescription":
      "粘贴笔记、拖入路演文稿，或直接描述项目。ZENO 会提取目标、约束与待解决的问题，供你确认。",
    "dialog.createProject.inputPlaceholder":
      "描述项目，或粘贴你已有的任何内容…",
    "dialog.createProject.titleLabel": "项目标题",
    "dialog.createProject.titlePlaceholder": "给项目起个名字",
    "dialog.createProject.attachFiles": "附加文件",
    "dialog.createProject.creatingWorkspace": "正在创建工作区…",
    "dialog.createProject.startBlank": "从空白开始",
    "dialog.createProject.extract": "提取 →",
    "dialog.createProject.extracting": "正在提取决策与主题…",
    "dialog.createProject.emptyExtraction":
      "无法从该文本中提取出任何决策。请补充更多背景，或从空白开始。",
    "dialog.createProject.back": "← 返回",
    "dialog.createProject.startBlankArrow": "从空白开始 →",
    "dialog.createProject.renameTopic": "重命名主题",
    "dialog.createProject.whatIsType": "什么是{type}？",
    "dialog.createProject.groupedPrefix": "ZENO 将 {count} 条决策归入 ",
    "dialog.createProject.topicSingular": "个主题",
    "dialog.createProject.topicPlural": "个主题",
    "dialog.createProject.groupedSuffix":
      "。提交前可重命名主题、取消勾选或移动条目。",
    "dialog.createProject.selectAtLeastOneToast":
      "创建工作区前，请至少选择一个提取的条目。",
    "dialog.createProject.selectAtLeastOneButton": "请至少选择一个条目",
    "dialog.createProject.confirmSummary":
      "确认 {topics} 个主题中的 {checked} 项 →",
    "dialog.createProject.extractFailed": "提取失败 —— 请重试或从空白开始。",

    // Project card
    "dialog.projectCard.deletedToast": "项目已删除。",
    "dialog.projectCard.deleteFailedToast": "删除项目失败。",
    "dialog.projectCard.actionsFor": "对 {name} 的操作",
    "dialog.projectCard.deleteProject": "删除项目",
    "dialog.projectCard.confirmTitle": "删除该项目？",
    "dialog.projectCard.confirmDescription":
      "这将永久删除“{name}”及其所有判断、真相与历史记录。此操作无法撤销。",
    "dialog.projectCard.cancel": "取消",
    "dialog.projectCard.delete": "删除",
    "dialog.projectCard.topicSingular": "个主题",
    "dialog.projectCard.topicPlural": "个主题",

    // Project API key dialog
    "dialog.apiKey.never": "从未",
    "dialog.apiKey.trigger": "MCP 与 API 密钥",
    "dialog.apiKey.title": "MCP 访问",
    "dialog.apiKey.description":
      "为外部编码代理生成绑定到项目的 API 密钥。每个密钥都可读取本项目的真相、直接写入常规真相，并将高影响变更转入审核。",
    "dialog.apiKey.currentProject": "当前项目",
    "dialog.apiKey.mcpEndpoint": "MCP 端点",
    "dialog.apiKey.copyUrl": "复制 URL",
    "dialog.apiKey.endpointHint":
      "将该 URL 用作 MCP 服务器端点，并将生成的密钥作为 Bearer 令牌发送。",
    "dialog.apiKey.labelPlaceholder":
      "密钥标签（可选，例如 Claude Code · 笔记本）",
    "dialog.apiKey.generateKey": "生成密钥",
    "dialog.apiKey.storageHint":
      "密钥仅显示一次。我们只存储 SHA-256 哈希，绝不存储原始令牌。",
    "dialog.apiKey.newKeyGenerated": "已生成新密钥",
    "dialog.apiKey.newKeyHint": "请立即复制该令牌。关闭此对话框后将不再显示。",
    "dialog.apiKey.shownOnce": "仅显示一次",
    "dialog.apiKey.copyKey": "复制密钥",
    "dialog.apiKey.existingKeys": "现有密钥",
    "dialog.apiKey.loading": "正在加载 API 密钥…",
    "dialog.apiKey.noKeys": "该项目尚无 API 密钥。",
    "dialog.apiKey.untitledKey": "未命名密钥",
    "dialog.apiKey.revoked": "已吊销",
    "dialog.apiKey.active": "有效",
    "dialog.apiKey.created": "创建于：{date}",
    "dialog.apiKey.lastUsed": "上次使用：{date}",
    "dialog.apiKey.revoke": "吊销",
    "dialog.apiKey.footer":
      "已吊销的密钥会立即返回 401。每个密钥仅绑定一个项目。",
    "dialog.apiKey.generatedToast":
      "API 密钥已生成。请立即复制 —— 它不会再次显示。",
    "dialog.apiKey.createFailedToast": "创建 API 密钥失败。",
    "dialog.apiKey.revokedToast": "API 密钥已吊销。",
    "dialog.apiKey.revokeFailedToast": "吊销 API 密钥失败。",
    "dialog.apiKey.loadFailedToast": "加载 API 密钥失败。",
    "dialog.apiKey.clipboardUnavailableToast": "此浏览器不支持剪贴板。",
    "dialog.apiKey.copyFailedToast": "复制到剪贴板失败。",
    "dialog.apiKey.mcpCopiedToast": "MCP 端点已复制到剪贴板。",
    "dialog.apiKey.keyCopiedToast": "API 密钥已复制到剪贴板。",

    // Login form
    "dialog.login.supabaseMissingToast":
      "缺少 Supabase 环境变量。请先添加公开 URL 与 anon 密钥。",
    "dialog.login.accountCreatedToast": "账户已创建。",
    "dialog.login.accountCreatedConfirmToast":
      "账户已创建。如果 Supabase 中启用了邮件确认，请先确认邮箱再登录。",
    "dialog.login.authFailedToast": "身份验证失败。",
    "dialog.login.signIn": "登录",
    "dialog.login.createAccount": "创建账户",
    "dialog.login.email": "邮箱",
    "dialog.login.emailPlaceholder": "you@example.com",
    "dialog.login.password": "密码",
    "dialog.login.passwordPlaceholder": "至少 6 个字符",
    "dialog.login.supabaseConfigHint":
      "添加 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 以启用身份验证。",

    // Project sidebar — new topic dialog + account fallback
    "dialog.sidebar.newTopicTitle": "新建主题",
    "dialog.sidebar.newTopicDescription":
      "为某个具体的决策或问题新建一个空白主题。",
    "dialog.sidebar.newTopicPlaceholder": "主题名称",
    "dialog.sidebar.create": "创建",
    "dialog.sidebar.authenticatedUser": "已认证用户",
    "dialog.sidebar.createTopicFailedToast": "创建主题失败。",
  },
  fr: {
    // Quick Notes dialog
    "dialog.quickNotes.title": "Notes rapides",
    "dialog.quickNotes.description":
      "Notez tout ce qui concerne ce projet. Amenez une note dans la conversation lorsque vous êtes prêt à en discuter.",
    "dialog.quickNotes.empty": "Aucune note pour l'instant.",
    "dialog.quickNotes.lastDiscussed": "Dernière discussion {when}",
    "dialog.quickNotes.notDiscussed": "Pas encore discuté",
    "dialog.quickNotes.sandbox": "Bac à sable",
    "dialog.quickNotes.deleteNote": "Supprimer la note",
    "dialog.quickNotes.placeholder": "Écrire une note rapide…",
    "dialog.quickNotes.add": "Ajouter",
    "dialog.quickNotes.noteLabel": "Note rapide",
    "dialog.quickNotes.loadedToast": "Note chargée dans la conversation.",

    // Project search dialog
    "dialog.search.title": "Rechercher",
    "dialog.search.description":
      "Recherchez parmi les vérités, candidats et idées de ce projet.",
    "dialog.search.placeholder": "Rechercher dans le projet…",
    "dialog.search.button": "Rechercher",
    "dialog.search.rankedByRelevance": "Classé par pertinence",
    "dialog.search.keywordMatches": "Correspondances de mots-clés",
    "dialog.search.prompt": "Saisissez une requête et appuyez sur Entrée.",
    "dialog.search.noMatches": "Aucune correspondance trouvée.",
    "dialog.search.failedToast": "La recherche a échoué.",
    "dialog.search.overlayMessage": "Recherche dans le projet",
    "dialog.search.overlaySubmessage":
      "Parcours des vérités, candidats et idées",

    // Create project modal
    "dialog.createProject.somethingWentWrong": "Une erreur est survenue.",
    "dialog.createProject.untitledProject": "Projet sans titre",
    "dialog.createProject.inputTitle": "Commencez avec ce que vous avez",
    "dialog.createProject.inputDescription":
      "Collez des notes, déposez un pitch deck ou décrivez le projet. ZENO extrait les objectifs, contraintes et questions ouvertes pour que vous les confirmiez.",
    "dialog.createProject.inputPlaceholder":
      "Décrivez le projet, ou collez tout ce que vous avez...",
    "dialog.createProject.titleLabel": "Titre du projet",
    "dialog.createProject.titlePlaceholder": "Nommez votre projet",
    "dialog.createProject.attachFiles": "Joindre des fichiers",
    "dialog.createProject.creatingWorkspace":
      "Création de l'espace de travail...",
    "dialog.createProject.startBlank": "Commencer à blanc",
    "dialog.createProject.extract": "Extraire →",
    "dialog.createProject.extracting": "Extraction des décisions et sujets...",
    "dialog.createProject.emptyExtraction":
      "Nous n'avons pu extraire aucune décision de ce texte. Ajoutez du contexte, ou commencez à blanc.",
    "dialog.createProject.back": "← Retour",
    "dialog.createProject.startBlankArrow": "Commencer à blanc →",
    "dialog.createProject.renameTopic": "Renommer le sujet",
    "dialog.createProject.whatIsType": "Qu'est-ce qu'un {type} ?",
    "dialog.createProject.groupedPrefix":
      "ZENO a regroupé {count} décisions en ",
    "dialog.createProject.topicSingular": "sujet",
    "dialog.createProject.topicPlural": "sujets",
    "dialog.createProject.groupedSuffix":
      ". Renommez les sujets, décochez des éléments ou déplacez-les avant de valider.",
    "dialog.createProject.selectAtLeastOneToast":
      "Sélectionnez au moins un élément extrait avant de créer l'espace de travail.",
    "dialog.createProject.selectAtLeastOneButton":
      "Sélectionnez au moins un élément",
    "dialog.createProject.confirmSummary":
      "Confirmer {checked} dans {topics} sujets →",
    "dialog.createProject.extractFailed":
      "Extraction impossible — réessayez ou commencez à blanc.",

    // Project card
    "dialog.projectCard.deletedToast": "Projet supprimé.",
    "dialog.projectCard.deleteFailedToast":
      "Échec de la suppression du projet.",
    "dialog.projectCard.actionsFor": "Actions pour {name}",
    "dialog.projectCard.deleteProject": "Supprimer le projet",
    "dialog.projectCard.confirmTitle": "Supprimer ce projet ?",
    "dialog.projectCard.confirmDescription":
      "Cela supprime définitivement « {name} » ainsi que tous ses jugements, vérités et son historique. Cette action est irréversible.",
    "dialog.projectCard.cancel": "Annuler",
    "dialog.projectCard.delete": "Supprimer",
    "dialog.projectCard.topicSingular": "sujet",
    "dialog.projectCard.topicPlural": "sujets",

    // Project API key dialog
    "dialog.apiKey.never": "Jamais",
    "dialog.apiKey.trigger": "MCP & clés API",
    "dialog.apiKey.title": "Accès MCP",
    "dialog.apiKey.description":
      "Générez des clés API liées au projet pour des agents de code externes. Chaque clé peut lire la vérité de ce projet, écrire directement la vérité courante et router les changements à fort impact vers une revue.",
    "dialog.apiKey.currentProject": "Projet actuel",
    "dialog.apiKey.mcpEndpoint": "Point de terminaison MCP",
    "dialog.apiKey.copyUrl": "Copier l'URL",
    "dialog.apiKey.endpointHint":
      "Utilisez cette URL comme point de terminaison du serveur MCP et envoyez la clé générée comme jeton Bearer.",
    "dialog.apiKey.labelPlaceholder":
      "Libellé de la clé (optionnel, ex. Claude Code · Portable)",
    "dialog.apiKey.generateKey": "Générer une clé",
    "dialog.apiKey.storageHint":
      "Les clés ne sont affichées qu'une fois. Nous ne stockons qu'un hachage SHA-256, jamais le jeton brut.",
    "dialog.apiKey.newKeyGenerated": "Nouvelle clé générée",
    "dialog.apiKey.newKeyHint":
      "Copiez ce jeton maintenant. Il ne sera plus visible après la fermeture de cette boîte de dialogue.",
    "dialog.apiKey.shownOnce": "affichée une fois",
    "dialog.apiKey.copyKey": "Copier la clé",
    "dialog.apiKey.existingKeys": "Clés existantes",
    "dialog.apiKey.loading": "Chargement des clés API...",
    "dialog.apiKey.noKeys": "Aucune clé API pour ce projet pour l'instant.",
    "dialog.apiKey.untitledKey": "Clé sans titre",
    "dialog.apiKey.revoked": "Révoquée",
    "dialog.apiKey.active": "Active",
    "dialog.apiKey.created": "Créée : {date}",
    "dialog.apiKey.lastUsed": "Dernière utilisation : {date}",
    "dialog.apiKey.revoke": "Révoquer",
    "dialog.apiKey.footer":
      "Les clés révoquées renvoient immédiatement 401. Chaque clé est liée à un seul projet.",
    "dialog.apiKey.generatedToast":
      "Clé API générée. Copiez-la maintenant — elle ne sera plus affichée.",
    "dialog.apiKey.createFailedToast": "Échec de la création de la clé API.",
    "dialog.apiKey.revokedToast": "Clé API révoquée.",
    "dialog.apiKey.revokeFailedToast": "Échec de la révocation de la clé API.",
    "dialog.apiKey.loadFailedToast": "Échec du chargement des clés API.",
    "dialog.apiKey.clipboardUnavailableToast":
      "Le presse-papiers est indisponible dans ce navigateur.",
    "dialog.apiKey.copyFailedToast":
      "Échec de la copie dans le presse-papiers.",
    "dialog.apiKey.mcpCopiedToast":
      "Point de terminaison MCP copié dans le presse-papiers.",
    "dialog.apiKey.keyCopiedToast": "Clé API copiée dans le presse-papiers.",

    // Login form
    "dialog.login.supabaseMissingToast":
      "Les variables d'environnement Supabase sont manquantes. Ajoutez d'abord l'URL publique et la clé anon.",
    "dialog.login.accountCreatedToast": "Compte créé.",
    "dialog.login.accountCreatedConfirmToast":
      "Compte créé. Si la confirmation par e-mail est activée dans Supabase, confirmez l'e-mail avant de vous connecter.",
    "dialog.login.authFailedToast": "Échec de l'authentification.",
    "dialog.login.signIn": "Se connecter",
    "dialog.login.createAccount": "Créer un compte",
    "dialog.login.email": "E-mail",
    "dialog.login.emailPlaceholder": "vous@exemple.com",
    "dialog.login.password": "Mot de passe",
    "dialog.login.passwordPlaceholder": "Au moins 6 caractères",
    "dialog.login.supabaseConfigHint":
      "Ajoutez `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` pour activer l'authentification.",

    // Project sidebar — new topic dialog + account fallback
    "dialog.sidebar.newTopicTitle": "Nouveau sujet",
    "dialog.sidebar.newTopicDescription":
      "Démarrez un sujet vierge pour une décision ou une question précise.",
    "dialog.sidebar.newTopicPlaceholder": "Nom du sujet",
    "dialog.sidebar.create": "Créer",
    "dialog.sidebar.authenticatedUser": "Utilisateur authentifié",
    "dialog.sidebar.createTopicFailedToast": "Échec de la création du sujet.",
  },
};
