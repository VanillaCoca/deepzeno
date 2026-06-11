type LocaleMessages = Record<"en" | "zh" | "fr", Record<string, string>>;

export const kickoffMessages: LocaleMessages = {
  en: {
    "kickoff.bannerTitle": "Project kickoff",
    "kickoff.bannerBody":
      "Answer the intake questions below in your own words, then let ZENO propose a topic breakdown. Every item lands as a candidate — you confirm what becomes truth.",
    "kickoff.propose": "Propose topics",
    "kickoff.proposing": "Synthesizing...",
    "kickoff.skip": "Skip — start blank",
    "kickoff.reviewTitle": "Proposed topic breakdown",
    "kickoff.reviewBody":
      "Check the topics you want to create. Their seed items land as candidates and ideas for you to review — nothing becomes truth here.",
    "kickoff.charterLabel": "Charter",
    "kickoff.seedCount": "{pending} candidates · {ideas} ideas",
    "kickoff.confirm": "Create {topics} topics + {nodes} seeds",
    "kickoff.cancel": "Cancel",
    "kickoff.confirmedToast":
      "{topics} topics created, {pending} candidates and {ideas} ideas seeded.",
    "kickoff.skippedToast": "Kickoff skipped. Starting blank.",
    "kickoff.emptyProposal":
      "ZENO couldn't form a proposal from the conversation so far. Add more detail and try again.",
    "kickoff.needsAnswers":
      "Answer the intake questions in the chat first, then propose topics.",
    "kickoff.failedToast": "Kickoff synthesis failed. Try again.",
  },
  zh: {
    "kickoff.bannerTitle": "项目开局",
    "kickoff.bannerBody":
      "先在下方用你自己的话回答开局问题，然后让 ZENO 提议主题拆解。所有条目都以候选形式出现 — 由你确认什么成为真相。",
    "kickoff.propose": "生成主题提案",
    "kickoff.proposing": "正在综合…",
    "kickoff.skip": "跳过 — 从空白开始",
    "kickoff.reviewTitle": "主题拆解提案",
    "kickoff.reviewBody":
      "勾选你想创建的主题。其种子条目会以候选和想法的形式等待你审阅 — 这里不会产生任何真相。",
    "kickoff.charterLabel": "主旨",
    "kickoff.seedCount": "{pending} 个候选 · {ideas} 个想法",
    "kickoff.confirm": "创建 {topics} 个主题 + {nodes} 个种子",
    "kickoff.cancel": "取消",
    "kickoff.confirmedToast":
      "已创建 {topics} 个主题，植入 {pending} 个候选和 {ideas} 个想法。",
    "kickoff.skippedToast": "已跳过开局，从空白开始。",
    "kickoff.emptyProposal":
      "ZENO 暂时无法从目前的对话中形成提案。补充更多细节后再试。",
    "kickoff.needsAnswers": "请先在对话中回答开局问题，再生成主题提案。",
    "kickoff.failedToast": "开局综合失败，请重试。",
  },
  fr: {
    "kickoff.bannerTitle": "Lancement du projet",
    "kickoff.bannerBody":
      "Répondez d'abord aux questions ci-dessous avec vos propres mots, puis laissez ZENO proposer un découpage en sujets. Chaque élément arrive comme candidat — vous confirmez ce qui devient vérité.",
    "kickoff.propose": "Proposer des sujets",
    "kickoff.proposing": "Synthèse en cours…",
    "kickoff.skip": "Passer — démarrer à blanc",
    "kickoff.reviewTitle": "Découpage en sujets proposé",
    "kickoff.reviewBody":
      "Cochez les sujets à créer. Leurs éléments d'amorce arrivent comme candidats et idées à examiner — rien ne devient vérité ici.",
    "kickoff.charterLabel": "Charte",
    "kickoff.seedCount": "{pending} candidats · {ideas} idées",
    "kickoff.confirm": "Créer {topics} sujets + {nodes} amorces",
    "kickoff.cancel": "Annuler",
    "kickoff.confirmedToast":
      "{topics} sujets créés, {pending} candidats et {ideas} idées semés.",
    "kickoff.skippedToast": "Lancement passé. Démarrage à blanc.",
    "kickoff.emptyProposal":
      "ZENO n'a pas pu former de proposition à partir de la conversation. Ajoutez des détails et réessayez.",
    "kickoff.needsAnswers":
      "Répondez d'abord aux questions dans la conversation, puis proposez des sujets.",
    "kickoff.failedToast": "Échec de la synthèse. Réessayez.",
  },
};
