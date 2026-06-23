import { Modal, Text } from "@mantine/core";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { useServerJsonImport } from "../../../hooks/useServerJsonImport";
import { ImportServerJsonPanel } from "../ImportServerJsonPanel/ImportServerJsonPanel";

const ModalTitle = Text.withProps({ fw: 700, span: true });

export interface ServerImportJsonModalProps {
  opened: boolean;
  /** Ids already in use — drives the duplicate-id warning. */
  existingIds: string[];
  onClose: () => void;
  /** Persist the chosen server. Resolves once the catalog has been updated. */
  onAddServer: (id: string, config: MCPServerConfig) => Promise<void> | void;
}

/**
 * Display shell for the registry `server.json` import (#1348). All orchestration
 * (parsing, debounced validation, selection, auto-collapse, submit) lives in
 * `useServerJsonImport`; this component only renders the modal + dumb panel.
 */
export function ServerImportJsonModal({
  opened,
  existingIds,
  onClose,
  onAddServer,
}: ServerImportJsonModalProps) {
  const vm = useServerJsonImport({ opened, existingIds, onAddServer });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      centered
      title={<ModalTitle>Import from registry config</ModalTitle>}
    >
      <ImportServerJsonPanel
        draft={vm.draft}
        validation={vm.validation}
        packages={vm.packages}
        envVars={vm.envVars}
        addDisabled={!vm.canAdd}
        fileContentsOpen={vm.fileContentsOpen}
        onFileContentsChange={vm.setFileContentsOpen}
        fileContentsHighlight={vm.fileContentsHighlight}
        onJsonChange={vm.setRawText}
        onSelectPackage={vm.selectPackage}
        onEnvVarChange={vm.setEnvVar}
        onServerNameChange={vm.setServerName}
        onAddServer={() => {
          void vm.submit().then((added) => {
            if (added) onClose();
          });
        }}
        onPickFile={(file) => void vm.pickFile(file)}
      />
    </Modal>
  );
}
