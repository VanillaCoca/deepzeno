// Lightweight client-side i18n. The UI language is chosen from the account menu
// and persisted; the same choice also tells the model which language to reply in
// (see localePromptName). English is the source/fallback language.

export type Locale = "en" | "zh" | "fr";

export const defaultLocale: Locale = "en";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "fr", label: "Français" },
];

// How each locale is named to the model when steering reply language.
export const localePromptName: Record<Locale, string> = {
  en: "English",
  zh: "Chinese (简体中文)",
  fr: "French (Français)",
};

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh" || value === "fr";
}

type Dictionary = Record<string, string>;

const en: Dictionary = {
  "nav.search": "Search",
  "nav.quickNotes": "Quick Notes",
  "nav.topics": "Topics",
  "nav.newTopic": "New topic",
  "nav.projectSelection": "Project selection",
  "nav.archived": "Archived",
  "view.conversation": "Conversation",
  "view.truthGraph": "Truth Graph",
  "account.language": "Language",
  "account.lightMode": "Light mode",
  "account.darkMode": "Dark mode",
  "account.logOut": "Log out",
  "truth.emptyTitle": "No truths yet",
  "truth.emptyBody":
    "Decisions and facts you confirm in the conversation appear here, connected as a map.",
  "truth.emptyCta": "Start a conversation",
  "greeting.title": "What can I help with?",
  "greeting.body":
    "Talk it through — ZENO turns your conversation into the decisions and facts in your truth graph.",
};

const zh: Dictionary = {
  "nav.search": "搜索",
  "nav.quickNotes": "速记",
  "nav.topics": "主题",
  "nav.newTopic": "新建主题",
  "nav.projectSelection": "项目选择",
  "nav.archived": "已归档",
  "view.conversation": "对话",
  "view.truthGraph": "真相图谱",
  "account.language": "语言",
  "account.lightMode": "浅色模式",
  "account.darkMode": "深色模式",
  "account.logOut": "退出登录",
  "truth.emptyTitle": "还没有真相节点",
  "truth.emptyBody":
    "你在对话中确认的决策与事实会出现在这里，并按彼此的关系连成一张图。",
  "truth.emptyCta": "开始对话",
  "greeting.title": "有什么可以帮你？",
  "greeting.body": "尽管说 —— ZENO 会把你的对话整理成真相图谱里的决策与事实。",
};

const fr: Dictionary = {
  "nav.search": "Rechercher",
  "nav.quickNotes": "Notes rapides",
  "nav.topics": "Sujets",
  "nav.newTopic": "Nouveau sujet",
  "nav.projectSelection": "Sélection de projet",
  "nav.archived": "Archivés",
  "view.conversation": "Conversation",
  "view.truthGraph": "Graphe de vérité",
  "account.language": "Langue",
  "account.lightMode": "Mode clair",
  "account.darkMode": "Mode sombre",
  "account.logOut": "Se déconnecter",
  "truth.emptyTitle": "Aucune vérité pour l'instant",
  "truth.emptyBody":
    "Les décisions et faits que vous confirmez dans la conversation apparaissent ici, reliés sous forme de carte.",
  "truth.emptyCta": "Démarrer une conversation",
  "greeting.title": "Comment puis-je vous aider ?",
  "greeting.body":
    "Expliquez librement — ZENO transforme votre conversation en décisions et faits dans votre graphe de vérité.",
};

export const dictionaries: Record<Locale, Dictionary> = { en, zh, fr };
