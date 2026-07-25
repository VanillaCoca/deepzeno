// Copy for the run activity bar — the "work in flight" half of the bar that
// otherwise reports what changed while the user was away.
//
// Two things every string here has to respect. First, a phase name is a claim
// about what the agent is doing right now, so it names the work ("collecting
// evidence"), never a percentage. Second, cost is always shown as an estimate
// and never rounded to zero: the whole reason ZENO needs a bar that Claude's UI
// does not is that ZENO's runs spend the user's money.
type LocaleMessages = Record<"en" | "zh" | "fr", Record<string, string>>;

export const activityMessages: LocaleMessages = {
  en: {
    "activity.title": "Work in progress",
    "activity.runType.research": "Researching",
    "activity.runType.patrol": "Watchtower patrol",
    "activity.runType.sweep": "Exploring the conversation",
    "activity.phase.plan": "planning",
    "activity.phase.collect": "collecting evidence",
    "activity.phase.judge": "judging",
    "activity.phase.land": "landing candidates",
    "activity.phase.extract": "extracting",
    "activity.phase.pending": "starting",
    "activity.counter": "{used}/{max}",
    "activity.costEstimate": "~{cost}",
    "activity.costPending": "cost not measured yet",
    "activity.multi": "{count} tasks running",
    "activity.longest": "longest {elapsed}",
    "activity.others": "and {count} more",
    "activity.cancel": "Stop",
    "activity.cancelling": "Stopping…",
    "activity.cancelFailed": "Could not stop this run",
    "activity.stale": "Lost contact",
    "activity.staleHint":
      "No progress for a while — the run may have been killed. It will be marked failed.",
    "activity.expand": "Show every run",
    "activity.collapse": "Collapse",
    "activity.totalCost": "spent so far {cost}",
  },
  zh: {
    "activity.title": "正在进行的工作",
    "activity.runType.research": "调研中",
    "activity.runType.patrol": "瞭望塔巡查",
    "activity.runType.sweep": "探索对话",
    "activity.phase.plan": "制定计划",
    "activity.phase.collect": "收集证据",
    "activity.phase.judge": "判断证据",
    "activity.phase.land": "落地候选",
    "activity.phase.extract": "提取中",
    "activity.phase.pending": "启动中",
    "activity.counter": "{used}/{max}",
    "activity.costEstimate": "约 {cost}",
    "activity.costPending": "尚未计量花费",
    "activity.multi": "{count} 个任务运行中",
    "activity.longest": "最长已用 {elapsed}",
    "activity.others": "另有 {count} 项",
    "activity.cancel": "取消",
    "activity.cancelling": "正在停止…",
    "activity.cancelFailed": "无法停止这次运行",
    "activity.stale": "失去联系",
    "activity.staleHint":
      "已经很久没有进展，这次运行可能已被中断，稍后会标记为失败。",
    "activity.expand": "展开全部",
    "activity.collapse": "收起",
    "activity.totalCost": "已花费 {cost}",
  },
  fr: {
    "activity.title": "Travail en cours",
    "activity.runType.research": "Recherche en cours",
    "activity.runType.patrol": "Patrouille de la vigie",
    "activity.runType.sweep": "Exploration de la conversation",
    "activity.phase.plan": "planification",
    "activity.phase.collect": "collecte des preuves",
    "activity.phase.judge": "évaluation",
    "activity.phase.land": "enregistrement des candidats",
    "activity.phase.extract": "extraction",
    "activity.phase.pending": "démarrage",
    "activity.counter": "{used}/{max}",
    "activity.costEstimate": "~{cost}",
    "activity.costPending": "coût pas encore mesuré",
    "activity.multi": "{count} tâches en cours",
    "activity.longest": "la plus longue {elapsed}",
    "activity.others": "et {count} de plus",
    "activity.cancel": "Arrêter",
    "activity.cancelling": "Arrêt en cours…",
    "activity.cancelFailed": "Impossible d'arrêter cette exécution",
    "activity.stale": "Contact perdu",
    "activity.staleHint":
      "Aucun progrès depuis un moment — l'exécution a peut-être été interrompue. Elle sera marquée comme échouée.",
    "activity.expand": "Afficher toutes les exécutions",
    "activity.collapse": "Réduire",
    "activity.totalCost": "dépensé jusqu'ici {cost}",
  },
};
