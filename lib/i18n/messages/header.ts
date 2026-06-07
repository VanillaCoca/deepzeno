type LocaleMessages = Record<"en" | "zh" | "fr", Record<string, string>>;

export const headerMessages: LocaleMessages = {
  en: {
    "header.toggleSidebar": "Toggle sidebar",
    "header.workspace": "Workspace",
    "header.archived": "archived",
    "header.back": "Back",
    "header.forward": "Forward",
    "header.exploreNewIdea": "Explore new idea",
    "header.workspaceView": "Workspace view",
    "header.ideas": "Ideas",
    "header.candidates": "Candidates",
    "header.exploreDescription":
      "Start fresh on a new idea in this topic? ZENO will review the current discussion before clearing.",
    "header.cancel": "Cancel",
    "header.exploreConfirm": "Yes, explore new",
  },
  zh: {
    "header.toggleSidebar": "切换侧边栏",
    "header.workspace": "工作台",
    "header.archived": "已归档",
    "header.back": "后退",
    "header.forward": "前进",
    "header.exploreNewIdea": "探索新想法",
    "header.workspaceView": "工作区视图",
    "header.ideas": "想法",
    "header.candidates": "候选",
    "header.exploreDescription":
      "在该主题里另起一个新想法？ZENO 会在清空前先回顾当前讨论。",
    "header.cancel": "取消",
    "header.exploreConfirm": "好，探索新想法",
  },
  fr: {
    "header.toggleSidebar": "Basculer la barre latérale",
    "header.workspace": "Espace de travail",
    "header.archived": "archivé",
    "header.back": "Précédent",
    "header.forward": "Suivant",
    "header.exploreNewIdea": "Explorer une nouvelle idée",
    "header.workspaceView": "Vue de l'espace de travail",
    "header.ideas": "Idées",
    "header.candidates": "Candidats",
    "header.exploreDescription":
      "Repartir sur une nouvelle idée dans ce sujet ? ZENO passera en revue la discussion actuelle avant de l'effacer.",
    "header.cancel": "Annuler",
    "header.exploreConfirm": "Oui, explorer",
  },
};
