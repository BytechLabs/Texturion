import Foundation

/// #690 / #689: the words for task numbers, references, links, the Filters
/// control, saved views for tasks and the quick-add line.
///
/// Its own section rather than a corner of `ContactsTasksStrings`: a `taskRefs.`
/// namespace is one feature, and a translator working through it sees the whole
/// of it in one place. The register is the one `CommonStrings` sets out: Quebec
/// French, vouvoiement, accents spelled normally. No em or en dashes anywhere in
/// rendered copy; the separator is a comma, a full stop or a middle dot.
///
/// Task numbers (`T-142`) and the reference words (`#T-142`, `#contact-…`,
/// `#conv-…`) are never translated: they are what people type and say, and the
/// server reads them back out of the saved text.
enum TaskReferencesStrings {
    static let section = AppStrings.Section(
        name: "TaskReferencesStrings",
        en: [
            // ── Relations ────────────────────────────────────────────────────
            "taskRefs.linksTitle": "Links",
            "taskRefs.linksEmpty": "No links yet.",
            "taskRefs.linksLoadFailed": "Couldn't load the links.",
            "taskRefs.relBlockedBy": "Blocked by",
            "taskRefs.relBlocks": "Blocks",
            "taskRefs.relParent": "Parent",
            "taskRefs.relSubTask": "Sub-tasks",
            "taskRefs.addLink": "Add a link",
            "taskRefs.addBlockedBy": "Blocked by a task",
            "taskRefs.addBlocks": "Blocks a task",
            "taskRefs.addParent": "Set the parent task",
            "taskRefs.addSubTask": "Add a sub-task",
            "taskRefs.removeLink": "Remove the link to {task}",
            "taskRefs.stateDone": "Done",
            "taskRefs.stateOpen": "Open",
            "taskRefs.errHasParent": "That task already has a parent. Remove the parent first.",
            "taskRefs.errRejected":
                "That link can't be added. It would make a loop, or a task is at its "
                + "limit of 50 links.",

            // ── Linked tasks on a conversation or a contact ─────────────────
            "taskRefs.linkedTitle": "Linked tasks",
            "taskRefs.linkedEmpty": "No linked tasks yet.",
            "taskRefs.linkedLoadFailed": "Couldn't load the linked tasks.",
            "taskRefs.howAnchored": "On this conversation",
            "taskRefs.howMentioned": "Mentioned here",
            "taskRefs.howPointsAt": "Points here",

            // ── The # picker ─────────────────────────────────────────────────
            "taskRefs.pickerTitle": "Point to",
            "taskRefs.pickerSearch": "Task, contact or conversation",
            "taskRefs.pickerEmpty": "Nothing matches. Try a task number, a title or a name.",

            // ── Activity ─────────────────────────────────────────────────────
            "taskRefs.aContact": "a contact",
            "taskRefs.inNote": "Referenced in a note on the conversation with {name}, by {by}",
            "taskRefs.inTask": "Referenced from {task}, by {by}",
            "taskRefs.inTaskFallback": "Referenced from another task, by {by}",
            "taskRefs.outContact": "Linked to contact {name}",
            "taskRefs.outConversation": "Linked to the conversation with {name}",
            "taskRefs.outTask": "Linked to {task}",
            "taskRefs.outOther": "Linked to another record",
            "taskRefs.histBlockedByAdded": "{by} marked this as blocked by {task}",
            "taskRefs.histBlockedByRemoved": "{by} removed the block by {task}",
            "taskRefs.histBlocksAdded": "{by} marked this as blocking {task}",
            "taskRefs.histBlocksRemoved": "{by} stopped this blocking {task}",
            "taskRefs.histParentAdded": "{by} made {task} the parent of this task",
            "taskRefs.histParentRemoved": "{by} removed {task} as the parent",
            "taskRefs.histSubTaskAdded": "{by} added {task} as a sub-task",
            "taskRefs.histSubTaskRemoved": "{by} removed the sub-task {task}",

            // ── The Filters control ──────────────────────────────────────────
            "taskRefs.filtersTitle": "Filters",
            "taskRefs.filtersSpoken": "Filters, {count} in use",
            "taskRefs.filtersClear": "Clear all",
            "taskRefs.filtersApply": "Apply",
            "taskRefs.filterPeople": "People",
            "taskRefs.filterAnyone": "Anyone",
            "taskRefs.filterCreatedBy": "Created by",
            "taskRefs.filterContact": "Contact",
            "taskRefs.filterAnyContact": "Any contact",
            "taskRefs.filterContactSelected": "Chosen contact",
            "taskRefs.filterClearContact": "Clear the contact filter",
            "taskRefs.filterDue": "Due",
            "taskRefs.dueAny": "Any time",
            "taskRefs.dueRange": "Between dates",
            "taskRefs.dueFrom": "From",
            "taskRefs.dueTo": "To",
            "taskRefs.filterDetails": "Details",
            "taskRefs.filterSource": "Where it came from",
            "taskRefs.filterAnySource": "Anywhere",
            "taskRefs.sourceText": "A text",
            "taskRefs.sourceCall": "A call",
            "taskRefs.sourceNone": "Added by hand",
            "taskRefs.filterHasAttachments": "Has files",
            "taskRefs.filterHasReferences": "Has references",
            "taskRefs.filterAnyLabel": "Any tag",
            "taskRefs.filterLayout": "Layout",
            "taskRefs.groupTitle": "Group by",
            "taskRefs.groupStatus": "Status",
            "taskRefs.groupAssignee": "Assignee",
            "taskRefs.groupPriority": "Priority",
            "taskRefs.sortUpdated": "Recently changed",

            // ── Saved views ──────────────────────────────────────────────────
            "taskRefs.viewsTitle": "Views",
            "taskRefs.viewsManage": "Manage views",
            "taskRefs.viewsEmpty": "No saved views yet. Set up the filters you use, then save the view.",
            "taskRefs.viewDefaultTag": "Opens first",
            "taskRefs.viewSharedTag": "Shared with the crew",
            "taskRefs.viewActions": "Actions for {name}",
            "taskRefs.viewDeleteBody":
                "The whole crew uses {name}. It will be gone for everyone.",
            "taskRefs.viewDropsDueChip":
                "Due today and Due this week change every day, so a view does not keep them. "
                + "Overdue and a range of dates are kept.",

            // ── Quick add ────────────────────────────────────────────────────
            "taskRefs.quickAddPlaceholder": "Fix furnace @rehman tomorrow 9am #urgent",
            "taskRefs.quickAddHint":
                "Write it the way you would say it. Add @name for who, a day and time for "
                + "when, #urgent for how much it matters, #name for a tag.",
            "taskRefs.quickAddPreview": "What I understood",
            "taskRefs.quickAddTitle": "Task",
            "taskRefs.quickAddNoTitle": "Add a few words for the title",
            "taskRefs.quickAddDue": "Due",
            "taskRefs.quickAddLeftInTitle": "Left in the title because nothing matched: {words}",
            "taskRefs.quickAddConfirm": "Add task",
            "taskRefs.quickAddFullForm": "More options",
        ],
        frCA: [
            // ── Relations ────────────────────────────────────────────────────
            "taskRefs.linksTitle": "Liens",
            "taskRefs.linksEmpty": "Aucun lien pour l'instant.",
            "taskRefs.linksLoadFailed": "Impossible de charger les liens.",
            "taskRefs.relBlockedBy": "Bloquée par",
            "taskRefs.relBlocks": "Bloque",
            "taskRefs.relParent": "Parente",
            "taskRefs.relSubTask": "Sous-tâches",
            "taskRefs.addLink": "Ajouter un lien",
            "taskRefs.addBlockedBy": "Bloquée par une tâche",
            "taskRefs.addBlocks": "Bloque une tâche",
            "taskRefs.addParent": "Choisir la tâche parente",
            "taskRefs.addSubTask": "Ajouter une sous-tâche",
            "taskRefs.removeLink": "Retirer le lien vers {task}",
            "taskRefs.stateDone": "Terminée",
            "taskRefs.stateOpen": "Ouverte",
            "taskRefs.errHasParent":
                "Cette tâche a déjà une tâche parente. Retirez d'abord la parente.",
            "taskRefs.errRejected":
                "Ce lien ne peut pas être ajouté. Il ferait une boucle, ou une tâche a "
                + "atteint sa limite de 50 liens.",

            // ── Linked tasks on a conversation or a contact ─────────────────
            "taskRefs.linkedTitle": "Tâches liées",
            "taskRefs.linkedEmpty": "Aucune tâche liée pour l'instant.",
            "taskRefs.linkedLoadFailed": "Impossible de charger les tâches liées.",
            "taskRefs.howAnchored": "Sur cette conversation",
            "taskRefs.howMentioned": "Mentionnée ici",
            "taskRefs.howPointsAt": "Renvoie ici",

            // ── The # picker ─────────────────────────────────────────────────
            "taskRefs.pickerTitle": "Faire référence à",
            "taskRefs.pickerSearch": "Tâche, client ou conversation",
            "taskRefs.pickerEmpty":
                "Aucun résultat. Essayez un numéro de tâche, un titre ou un nom.",

            // ── Activity ─────────────────────────────────────────────────────
            "taskRefs.aContact": "un client",
            "taskRefs.inNote":
                "Mentionnée dans une note de la conversation avec {name}, par {by}",
            "taskRefs.inTask": "Mentionnée depuis {task}, par {by}",
            "taskRefs.inTaskFallback": "Mentionnée depuis une autre tâche, par {by}",
            "taskRefs.outContact": "Liée au client {name}",
            "taskRefs.outConversation": "Liée à la conversation avec {name}",
            "taskRefs.outTask": "Liée à {task}",
            "taskRefs.outOther": "Liée à un autre élément",
            "taskRefs.histBlockedByAdded": "{by} a indiqué que celle-ci est bloquée par {task}",
            "taskRefs.histBlockedByRemoved": "{by} a retiré le blocage par {task}",
            "taskRefs.histBlocksAdded": "{by} a indiqué que celle-ci bloque {task}",
            "taskRefs.histBlocksRemoved": "{by} a indiqué que celle-ci ne bloque plus {task}",
            "taskRefs.histParentAdded": "{by} a fait de {task} la tâche parente",
            "taskRefs.histParentRemoved": "{by} a retiré {task} comme tâche parente",
            "taskRefs.histSubTaskAdded": "{by} a ajouté {task} comme sous-tâche",
            "taskRefs.histSubTaskRemoved": "{by} a retiré la sous-tâche {task}",

            // ── The Filters control ──────────────────────────────────────────
            "taskRefs.filtersTitle": "Filtres",
            "taskRefs.filtersSpoken": "Filtres, {count} actifs",
            "taskRefs.filtersClear": "Tout effacer",
            "taskRefs.filtersApply": "Appliquer",
            "taskRefs.filterPeople": "Personnes",
            "taskRefs.filterAnyone": "Tout le monde",
            "taskRefs.filterCreatedBy": "Créée par",
            "taskRefs.filterContact": "Client",
            "taskRefs.filterAnyContact": "Tous les clients",
            "taskRefs.filterContactSelected": "Client choisi",
            "taskRefs.filterClearContact": "Effacer le filtre de client",
            "taskRefs.filterDue": "Échéance",
            "taskRefs.dueAny": "En tout temps",
            "taskRefs.dueRange": "Entre deux dates",
            "taskRefs.dueFrom": "Du",
            "taskRefs.dueTo": "Au",
            "taskRefs.filterDetails": "Détails",
            "taskRefs.filterSource": "Provenance",
            "taskRefs.filterAnySource": "N'importe où",
            "taskRefs.sourceText": "Un texto",
            "taskRefs.sourceCall": "Un appel",
            "taskRefs.sourceNone": "Ajoutée à la main",
            "taskRefs.filterHasAttachments": "Avec fichiers",
            "taskRefs.filterHasReferences": "Avec références",
            "taskRefs.filterAnyLabel": "Toutes les étiquettes",
            "taskRefs.filterLayout": "Affichage",
            "taskRefs.groupTitle": "Regrouper par",
            "taskRefs.groupStatus": "Statut",
            "taskRefs.groupAssignee": "Responsable",
            "taskRefs.groupPriority": "Priorité",
            "taskRefs.sortUpdated": "Modifiées récemment",

            // ── Saved views ──────────────────────────────────────────────────
            "taskRefs.viewsTitle": "Vues",
            "taskRefs.viewsManage": "Gérer les vues",
            "taskRefs.viewsEmpty":
                "Aucune vue enregistrée. Réglez les filtres que vous utilisez, puis "
                + "enregistrez la vue.",
            "taskRefs.viewDefaultTag": "S'ouvre en premier",
            "taskRefs.viewSharedTag": "Partagée avec l'équipe",
            "taskRefs.viewActions": "Actions pour {name}",
            "taskRefs.viewDeleteBody":
                "Toute l'équipe utilise {name}. Elle disparaîtra pour tout le monde.",
            "taskRefs.viewDropsDueChip":
                "Échéance aujourd'hui et Échéance cette semaine changent chaque jour, "
                + "donc une vue ne les garde pas. En retard et une plage de dates sont "
                + "conservées.",

            // ── Quick add ────────────────────────────────────────────────────
            "taskRefs.quickAddPlaceholder": "Fix furnace @rehman tomorrow 9am #urgent",
            "taskRefs.quickAddHint":
                "Ajoutez @nom pour qui, #urgent pour l'importance et #étiquette pour une "
                + "étiquette. Écrivez les jours et les heures en anglais : tomorrow 9am, "
                + "friday, in 2 days.",
            "taskRefs.quickAddPreview": "Ce que j'ai compris",
            "taskRefs.quickAddTitle": "Tâche",
            "taskRefs.quickAddNoTitle": "Ajoutez quelques mots pour le titre",
            "taskRefs.quickAddDue": "Échéance",
            "taskRefs.quickAddLeftInTitle":
                "Laissé dans le titre, car rien ne correspondait : {words}",
            "taskRefs.quickAddConfirm": "Ajouter la tâche",
            "taskRefs.quickAddFullForm": "Plus d'options",
        ]
    )
}
