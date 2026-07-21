type LocaleMessages = Record<"en" | "zh" | "fr", Record<string, string>>;

export const homeMessages: LocaleMessages = {
  en: {
    "home.projects": "Projects",
    "home.newProject": "New project",
    "home.empty": "You haven't started any projects yet.",
    "home.greetingMorning": "Good morning",
    "home.greetingAfternoon": "Good afternoon",
    "home.greetingEvening": "Good evening",
    "home.tagline": "Research a project, not just a question",
    "home.projectCountOne": "1 project",
    "home.projectCountOther": "{count} projects",
    "home.emptyTitle": "Create your first project",
    "home.emptyBody":
      "A project holds your topics and conversations — ZENO builds a Truth Graph from them as you think.",
  },
  zh: {
    "home.projects": "项目",
    "home.newProject": "新建项目",
    "home.empty": "你还没有任何项目。",
    "home.greetingMorning": "早上好",
    "home.greetingAfternoon": "下午好",
    "home.greetingEvening": "晚上好",
    "home.tagline": "调研一个项目，而不只是一个问题",
    "home.projectCountOne": "1 个项目",
    "home.projectCountOther": "{count} 个项目",
    "home.emptyTitle": "创建你的第一个项目",
    "home.emptyBody":
      "项目承载你的主题与对话 —— 你思考的同时，ZENO 会据此构建一张真相图谱。",
  },
  fr: {
    "home.projects": "Projets",
    "home.newProject": "Nouveau projet",
    "home.empty": "Vous n'avez pas encore de projet.",
    "home.greetingMorning": "Bonjour",
    "home.greetingAfternoon": "Bon après-midi",
    "home.greetingEvening": "Bonsoir",
    "home.tagline": "Étudiez un projet, pas seulement une question",
    "home.projectCountOne": "1 projet",
    "home.projectCountOther": "{count} projets",
    "home.emptyTitle": "Créez votre premier projet",
    "home.emptyBody":
      "Un projet rassemble vos sujets et conversations — ZENO en construit un graphe de vérité au fil de votre réflexion.",
  },
};
