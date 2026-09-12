import { toast } from "sonner";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { message, type MessageDefinition, type MessageKey } from "./index";

/**
 * How a message reaches a person.
 *
 * Deliberately separate from what the message *says*. The catalogue decides
 * the words and the severity; this decides whether they arrive as a toast or
 * as a dialog that has to be answered — and that is a decision about context,
 * made at the call site.
 *
 * Pages do not implement their own toasts or their own confirmation dialogs.
 * When they each did, the same action confirmed differently in three places
 * and one of them forgot to confirm at all.
 *
 * ```ts
 * notify.success("reports.publish.success");
 * notify.error("common.save.error");
 * const ok = await confirm("reports.delete.confirm", { title: report.title });
 * ```
 */

type Values = Record<string, string | number>;

const show = (definition: MessageDefinition) => {
  const options = definition.body ? { description: definition.body } : {};
  switch (definition.severity) {
    case "success":
      return toast.success(definition.title, options);
    case "warning":
      return toast.warning(definition.title, options);
    case "error":
      return toast.error(definition.title, options);
    default:
      return toast(definition.title, options);
  }
};

/**
 * Say something, in whatever way its severity calls for.
 *
 * The key decides the words; the definition's own severity decides the tone.
 * A caller that wants to override the tone is usually using the wrong key.
 */
export const notify = {
  show: (key: MessageKey | string, values?: Values) => show(message(key, values)),
  success: (key: MessageKey | string, values?: Values) =>
    show({ ...message(key, values), severity: "success" }),
  info: (key: MessageKey | string, values?: Values) =>
    show({ ...message(key, values), severity: "info" }),
  warning: (key: MessageKey | string, values?: Values) =>
    show({ ...message(key, values), severity: "warning" }),
  /**
   * Something went wrong, and what the server said about it.
   *
   * `detail` is the server's own refusal — "at least one role has to be able
   * to administer Oikonomia" — and it is the half that tells somebody what to
   * do next. It used to go to the console while the person got a generic
   * apology, which reads as a control that silently did nothing.
   */
  error: (key: MessageKey | string, values?: Values, detail?: string) => {
    const definition = message(key, values);
    return show({
      ...definition,
      severity: "error",
      ...(detail ? { body: detail } : {}),
    });
  },
};

/* ----------------------------------------------------------- confirmation */

interface Pending {
  definition: MessageDefinition;
  resolve: (confirmed: boolean) => void;
}

const ConfirmContext = createContext<((key: string, values?: Values) => Promise<boolean>) | null>(
  null,
);

/**
 * Ask before something irreversible.
 *
 * One dialog for the whole application, resolved as a promise so the call site
 * reads as what it is:
 *
 * ```ts
 * if (await confirm("reports.delete.confirm", { title })) remove();
 * ```
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback(
    (key: string, values?: Values) =>
      new Promise<boolean>((resolve) => {
        setPending({ definition: message(key, values), resolve });
      }),
    [],
  );

  const close = (confirmed: boolean) => {
    pending?.resolve(confirmed);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          /* Dismissing is declining: a confirmation that resolves true when
             somebody pressed Escape is a confirmation that did not happen. */
          if (!open) close(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.definition.title}</AlertDialogTitle>
            {pending?.definition.body ? (
              <AlertDialogDescription>{pending.definition.body}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>
              {pending?.definition.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => close(true)}>
              {pending?.definition.confirmLabel ?? "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

/**
 * The confirmation asker.
 *
 * Outside the provider it resolves **false** rather than throwing: a component
 * rendered somewhere unexpected must not perform a destructive action because
 * its dialog was unavailable.
 */
export function useConfirm() {
  const ask = useContext(ConfirmContext);
  return useMemo(
    () =>
      ask ??
      (async (key: string) => {
        console.error(`No ConfirmProvider is mounted; refusing to confirm "${key}".`);
        return false;
      }),
    [ask],
  );
}
