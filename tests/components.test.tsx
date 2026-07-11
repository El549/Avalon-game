// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IdentityReveal } from "@client/components/IdentityReveal";
import { QuestBallot } from "@client/components/QuestBallot";

describe("身份与任务票界面", () => {
  it("只有按住时显示身份，松手后再次隐藏", async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    render(<IdentityReveal role="merlin" knownPlayers={[{ playerId: "3", nickname: "阿乔", seat: 3 }]} onConfirm={confirm} />);
    const hold = screen.getByRole("button", { name: "按住查看身份，松手隐藏" });
    expect(screen.queryByText("你属于正义方")).not.toBeInTheDocument();
    fireEvent.pointerDown(hold, { pointerId: 1 });
    expect(screen.getByText("你属于正义方")).toBeInTheDocument();
    expect(screen.getByText("3号 阿乔")).toBeInTheDocument();
    fireEvent.pointerUp(hold, { pointerId: 1 });
    expect(screen.queryByText("你属于正义方")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "我已记住" }));
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("正义方看到两张票，但失败票明确不可选择", () => {
    render(<QuestBallot missionNumber={1} faction="good" orderKey="b" onSubmit={vi.fn()} />);
    expect(screen.getByText("任务成功")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /任务失败/ })).toBeDisabled();
    expect(screen.getByText("你的身份不能选择此票")).toBeInTheDocument();
  });

  it("邪恶方可以选择失败票并确认", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<QuestBallot missionNumber={2} faction="evil" orderKey="a" onSubmit={submit} />);
    await userEvent.click(screen.getByRole("radio", { name: /任务失败/ }));
    await userEvent.click(screen.getByRole("button", { name: "确认任务票" }));
    expect(submit).toHaveBeenCalledWith("failure");
  });

  it("任务票顺序由稳定键决定，能够出现两种上下排列", () => {
    const first = render(<QuestBallot missionNumber={1} faction="evil" orderKey="a" onSubmit={vi.fn()} />);
    expect(screen.getAllByRole("radio").map((option) => option.textContent)).toEqual([
      expect.stringContaining("任务失败"),
      expect.stringContaining("任务成功"),
    ]);
    first.unmount();
    render(<QuestBallot missionNumber={1} faction="evil" orderKey="b" onSubmit={vi.fn()} />);
    expect(screen.getAllByRole("radio").map((option) => option.textContent)).toEqual([
      expect.stringContaining("任务成功"),
      expect.stringContaining("任务失败"),
    ]);
  });
});
