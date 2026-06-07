type LocaleMessages = Record<"en" | "zh" | "fr", Record<string, string>>;

export const chatMessages: LocaleMessages = {
  en: {
    "chat.loadingWorkspace": "Loading workspace...",
    "chat.editMessage": "Edit your message...",
    "chat.askAnything": "Ask anything...",
    "chat.searchModels": "Search models...",
    "chat.sandboxNextMessage": "Your next message will include {title}",
  },
  zh: {
    "chat.loadingWorkspace": "正在加载工作台…",
    "chat.editMessage": "编辑你的消息…",
    "chat.askAnything": "问点什么…",
    "chat.searchModels": "搜索模型…",
    "chat.sandboxNextMessage": "下一条消息将包含 {title}",
  },
  fr: {
    "chat.loadingWorkspace": "Chargement de l'espace de travail…",
    "chat.editMessage": "Modifier votre message…",
    "chat.askAnything": "Posez votre question…",
    "chat.searchModels": "Rechercher des modèles…",
    "chat.sandboxNextMessage": "Votre prochain message inclura {title}",
  },
};
