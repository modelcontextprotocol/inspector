export type FocusArea =
  | "serverList"
  | "tabs"
  // Used by Resources/Prompts/Tools - list pane
  | "tabContentList"
  // Used by Resources/Prompts/Tools - details pane
  | "tabContentDetails"
  // Used only when activeTab === 'messages'
  | "messagesList"
  | "messagesDetail";
