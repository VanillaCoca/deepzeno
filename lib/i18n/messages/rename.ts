type LocaleMessages = Record<"en" | "zh" | "fr", Record<string, string>>;

export const renameMessages: LocaleMessages = {
  en: {
    "rename.menu": "Rename",
    "rename.topicTitle": "Rename topic",
    "rename.projectTitle": "Rename project",
    "rename.topicPlaceholder": "Topic name",
    "rename.projectPlaceholder": "Project name",
    "rename.save": "Rename",
    "rename.failed": "Couldn't rename.",
  },
  zh: {
    "rename.menu": "重命名",
    "rename.topicTitle": "重命名主题",
    "rename.projectTitle": "重命名项目",
    "rename.topicPlaceholder": "主题名称",
    "rename.projectPlaceholder": "项目名称",
    "rename.save": "重命名",
    "rename.failed": "重命名失败。",
  },
  fr: {
    "rename.menu": "Renommer",
    "rename.topicTitle": "Renommer le sujet",
    "rename.projectTitle": "Renommer le projet",
    "rename.topicPlaceholder": "Nom du sujet",
    "rename.projectPlaceholder": "Nom du projet",
    "rename.save": "Renommer",
    "rename.failed": "Échec du renommage.",
  },
};
