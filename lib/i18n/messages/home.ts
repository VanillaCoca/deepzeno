type LocaleMessages = Record<"en" | "zh" | "fr", Record<string, string>>;

export const homeMessages: LocaleMessages = {
  en: {
    "home.projects": "Projects",
    "home.newProject": "New project",
    "home.empty": "You haven't started any projects yet.",
  },
  zh: {
    "home.projects": "项目",
    "home.newProject": "新建项目",
    "home.empty": "你还没有任何项目。",
  },
  fr: {
    "home.projects": "Projets",
    "home.newProject": "Nouveau projet",
    "home.empty": "Vous n'avez pas encore de projet.",
  },
};
