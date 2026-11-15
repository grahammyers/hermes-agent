// @vitest-environment jsdom
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ModelPickerDialog } from "@/components/ModelPickerDialog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const options = {
  provider: "anthropic",
  model: "old-model",
  providers: [
    {
      name: "Anthropic",
      slug: "anthropic",
      models: ["expensive-model"],
      is_current: true,
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openAndSelectModel() {
  await waitFor(() => expect(screen.getByText("expensive-model")).toBeTruthy());
  fireEvent.click(screen.getAllByText("expensive-model")[0]);
}

describe("ModelPickerDialog close and confirmation behavior", () => {
  it("lets Escape close the warning while keeping the picker open", async () => {
    const onClose = vi.fn();
    const onApply = vi.fn().mockResolvedValue({
      confirm_required: true,
      confirm_message: "High cost",
    });
    render(
      <ModelPickerDialog
        loader={async () => options}
        onApply={onApply}
        onClose={onClose}
      />,
    );

    await openAndSelectModel();
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(await screen.findByText("Expensive Model Warning")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByText("Expensive Model Warning")).toBeNull(),
    );
    expect(screen.getByRole("dialog", { name: "Switch Model" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks Escape, backdrop, X, and Cancel until a deferred apply fails", async () => {
    const apply = deferred<void>();
    const onClose = vi.fn();
    render(
      <ModelPickerDialog
        loader={async () => options}
        onApply={() => apply.promise}
        onClose={onClose}
      />,
    );

    await openAndSelectModel();
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("dialog", { name: "Switch Model" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Switch Model" })).toBeTruthy();

    await act(async () => apply.reject(new Error("write failed")));
    expect(await screen.findByText("write failed")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes after the deferred apply succeeds", async () => {
    const apply = deferred<void>();
    const onClose = vi.fn();
    render(
      <ModelPickerDialog
        loader={async () => options}
        onApply={() => apply.promise}
        onClose={onClose}
      />,
    );

    await openAndSelectModel();
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => apply.resolve(undefined));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe("ConfirmDialog focus safety", () => {
  it("blocks Escape and backdrop cancellation while loading", () => {
    const onCancel = vi.fn();
    const onWindowEscape = vi.fn();
    window.addEventListener("keydown", onWindowEscape);
    render(
      <ConfirmDialog
        open
        destructive
        loading
        title="Delete item?"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog"));

    expect(onCancel).not.toHaveBeenCalled();
    expect(onWindowEscape).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowEscape);
  });

  it("focuses Cancel for destructive confirmation and Confirm otherwise", () => {
    const { rerender } = render(
      <ConfirmDialog
        open
        destructive
        title="Delete item?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );

    rerender(
      <ConfirmDialog
        open
        title="Continue?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Confirm" }),
    );
  });

  it("keeps focus through callback churn and loading changes, then restores the opener on close", () => {
    const cancelBeforeOpen = vi.fn();
    const cancelWhileLoading = vi.fn();
    const latestCancel = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Open dialog</button>
        <ConfirmDialog
          open={false}
          destructive
          title="Delete item?"
          onCancel={cancelBeforeOpen}
          onConfirm={vi.fn()}
        />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Open dialog" });
    opener.focus();

    rerender(
      <>
        <button type="button">Open dialog</button>
        <ConfirmDialog
          open
          destructive
          title="Delete item?"
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </>,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );

    rerender(
      <>
        <button type="button">Open dialog</button>
        <ConfirmDialog
          open
          destructive
          loading
          title="Delete item?"
          onCancel={cancelWhileLoading}
          onConfirm={vi.fn()}
        />
      </>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancelWhileLoading).not.toHaveBeenCalled();

    rerender(
      <>
        <button type="button">Open dialog</button>
        <ConfirmDialog
          open
          destructive
          title="Delete item?"
          onCancel={latestCancel}
          onConfirm={vi.fn()}
        />
      </>,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(latestCancel).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <button type="button">Open dialog</button>
        <ConfirmDialog
          open={false}
          destructive
          title="Delete item?"
          onCancel={latestCancel}
          onConfirm={vi.fn()}
        />
      </>,
    );
    expect(document.activeElement).toBe(opener);
    expect(cancelBeforeOpen).not.toHaveBeenCalled();
  });
});
