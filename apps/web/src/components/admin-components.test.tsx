// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmAction } from "./confirm-action";
import { MfaChallenge } from "./mfa-challenge";

vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

afterEach(() => {
  cleanup();
});

async function expectAccessible(ui: ReactElement) {
  const { container } = render(<main>{ui}</main>);
  const result = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  cleanup();
}

describe("ConfirmAction (irreversible staff actions)", () => {
  it("only acts after the exact phrase is typed", async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    render(
      <ConfirmAction
        label="Revoke badge"
        phrase="REVOKE"
        consequence="The badge stops showing."
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke badge…" }));
    const dialog = screen.getByRole("alertdialog", { name: "Revoke badge?" });
    expect(dialog.textContent).toMatch(/can't be undone/);
    const confirm = screen.getByRole("button", { name: "Revoke badge" });
    expect(confirm).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Type REVOKE to confirm"), {
      target: { value: "revoke" },
    });
    expect(confirm).toHaveProperty("disabled", true);
    fireEvent.submit(dialog);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Type REVOKE to confirm"), {
      target: { value: "REVOKE" },
    });
    expect(confirm).toHaveProperty("disabled", false);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole("button", { name: "Revoke badge…" })).toBeTruthy();
  });

  it("shows the API's refusal and stays open", async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error("boom")));
    render(
      <ConfirmAction
        label="End assignment"
        phrase="END"
        consequence="Ends it."
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "End assignment…" }));
    fireEvent.change(screen.getByLabelText("Type END to confirm"), { target: { value: "END" } });
    fireEvent.click(screen.getByRole("button", { name: "End assignment" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("is accessible when open", async () => {
    render(
      <ConfirmAction
        label="Sign out everywhere"
        phrase="SIGN OUT"
        consequence="All devices."
        onConfirm={() => Promise.resolve()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere…" }));
    const html = document.body.innerHTML;
    cleanup();
    const { container } = render(<main dangerouslySetInnerHTML={{ __html: html }} />);
    const result = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("MfaChallenge (two-step sign-in)", () => {
  it("asks for a 6-digit code and passes it on", async () => {
    const resolve = vi.fn(() => Promise.resolve());
    render(<MfaChallenge available resolve={resolve} />);
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "12ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText(/Enter the 6-digit code/)).toBeTruthy();
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/6-digit code/), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith("123456");
    });
  });

  it("explains a wrong code, and accounts without an authenticator app", async () => {
    render(<MfaChallenge available resolve={() => Promise.reject(new Error("invalid code"))} />);
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText(/Codes change every 30 seconds/)).toBeTruthy();
    cleanup();
    render(<MfaChallenge available={false} resolve={() => Promise.resolve()} />);
    expect(screen.getByText(/super admin/)).toBeTruthy();
  });

  it("is accessible", async () => {
    await expectAccessible(<MfaChallenge available resolve={() => Promise.resolve()} />);
  });
});
