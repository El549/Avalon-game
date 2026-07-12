import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { io as createSocketClient, type Socket as ClientSocket } from "socket.io-client";

interface Credentials {
  roomCode: string;
  playerId: string;
  token: string;
}

interface JoinedPlayer {
  page: Page;
  seat: number;
  nickname: string;
  credentials: Credentials;
}

interface CommandResult {
  ok: boolean;
  error?: { message: string };
}

const EXPERIENCE_PLAYER_NAMES = ["第一台手机", "第二台手机", "模拟骑士A", "模拟骑士B", "模拟骑士C"];
const MOBILE_LONG_PLAYER_NAMES = [
  "湖畔远征守望骑士甲乙丙丁",
  "星辉王庭守门骑士甲乙丙丁",
  "迷雾森林巡夜骑士甲乙丙丁",
  "圆桌边缘观察骑士甲乙丙丁",
  "圣杯远征记录骑士甲乙丙丁",
  "永夜城堡守望骑士甲乙丙丁",
  "古老王庭引路骑士甲乙丙丁",
  "风暴海岸传信骑士甲乙丙丁",
  "月桂王冠保管骑士甲乙丙丁",
  "北境烽火巡查骑士甲乙丙丁",
];
const BOARD_LONG_PLAYER_NAMES = [
  "湖畔圆桌远征骑士甲乙丙丁",
  "星辉王庭守门骑士甲乙丙丁",
  "迷雾森林巡夜骑士甲乙丙丁",
  "圆桌边缘观察骑士甲乙丙丁",
  "阿瓦隆远征守望骑士甲乙丙",
  "永夜城堡记录骑士甲乙丙丁",
  "古老圣杯守护骑士甲乙丙丁",
  "风暴海岸引路骑士甲乙丙丁",
  "月桂王冠保管骑士甲乙丙丁",
  "北境烽火传信骑士甲乙丙丁",
];

test("七人桌局从创建、认身份到刺杀和重开完整可用", async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  const extraContexts: BrowserContext[] = [];

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "你的昵称" }).fill("房主");
    await page.getByRole("button", { name: /^进阶/ }).click();
    await page.locator("form").getByRole("button", { name: "创建桌局" }).click();
    await expect(page).toHaveURL(/\/room\/\d{6}$/);

    const roomCode = page.url().match(/(\d{6})$/)?.[1];
    if (!roomCode) throw new Error("创建房间后没有得到房间号");
    const hostCredentials = await page.evaluate((code) => {
      const stored = localStorage.getItem(`round-table-session:${code}`);
      return stored ? JSON.parse(stored) as Credentials : null;
    }, roomCode);
    if (!hostCredentials) throw new Error("房主身份没有保存在当前设备");

    const players: JoinedPlayer[] = [{ page, seat: 1, nickname: "房主", credentials: hostCredentials }];
    for (let seat = 2; seat <= 7; seat += 1) {
      const nickname = `玩家${seat}`;
      const response = await request.post(`/api/rooms/${roomCode}/join`, { data: { nickname, seat } });
      expect(response.status()).toBe(201);
      const body = await response.json() as { data: { credentials: Credentials } };
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      });
      extraContexts.push(context);
      await context.addInitScript(({ code, credentials }) => {
        localStorage.setItem(`round-table-session:${code}`, JSON.stringify(credentials));
      }, { code: roomCode, credentials: body.data.credentials });
      const playerPage = await context.newPage();
      await playerPage.goto(`/room/${roomCode}`);
      players.push({ page: playerPage, seat, nickname, credentials: body.data.credentials });
    }

    const boardContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    extraContexts.push(boardContext);
    const board = await boardContext.newPage();
    await board.goto(`/room/${roomCode}/board`);
    await expect(board.getByText("7 / 7 已就座")).toBeVisible();
    if (process.env.CAPTURE_VISUAL_QA) await board.screenshot({ path: "/tmp/avalon-board-lobby.png", fullPage: true });

    await Promise.all(players.map(async (player) => {
      const ready = player.page.getByRole("button", { name: "确认座位并准备" });
      await expect(ready).toBeVisible();
      await ready.click();
    }));
    const start = page.getByRole("button", { name: "开始分配身份" });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(board.getByRole("heading", { name: "等待所有人记住身份" })).toBeVisible();
    await expectBoardHasNoRoles(board);

    const roleBySeat = new Map<number, string>();
    for (const player of players) {
      const hold = player.page.getByRole("button", { name: "按住查看身份，松手隐藏" });
      await expect(hold).toBeVisible();
      const holdBox = await hold.boundingBox();
      if (!holdBox) throw new Error(`${player.seat} 号玩家的身份封印不在可视区域`);
      await player.page.mouse.move(holdBox.x + holdBox.width / 2, holdBox.y + holdBox.height / 2);
      await player.page.mouse.down();
      const roleHeading = player.page.locator(".identity-details h2");
      await expect(roleHeading, `${player.seat} 号玩家按住身份后应看到角色`).toBeVisible();
      const holdBoxWhileRevealed = await hold.boundingBox();
      expect(holdBoxWhileRevealed, `${player.seat} 号玩家按住身份时按钮不应移动`).not.toBeNull();
      expect(Math.abs(holdBoxWhileRevealed!.y - holdBox.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(holdBoxWhileRevealed!.height - holdBox.height)).toBeLessThanOrEqual(1);
      const role = (await roleHeading.textContent())?.trim();
      if (!role) throw new Error(`${player.seat} 号玩家未看到身份`);
      roleBySeat.set(player.seat, role);
      if (process.env.CAPTURE_VISUAL_QA && player.seat === 2) {
        await player.page.locator(".identity-vault > img").evaluate(async (image) => {
          await (image as HTMLImageElement).decode();
        });
        await player.page.waitForTimeout(300);
        await player.page.screenshot({ path: "/tmp/avalon-identity-final.png", fullPage: true });
      }
      await player.page.mouse.up();
      await expect(roleHeading).toBeHidden();
      await player.page.getByRole("button", { name: "我已记住" }).click();
    }

    expect([...roleBySeat.values()].filter((role) => role === "梅林")).toHaveLength(1);
    expect([...roleBySeat.values()].filter((role) => role === "刺客")).toHaveLength(1);
    await expect(board.getByRole("heading", { name: /队长正在选择 \d+ 名队员/ })).toBeVisible();
    await expectBoardHasNoRoles(board);

    // 模拟一名玩家刷新页面，确认座位、身份和当前进度都能恢复。
    await players[3].page.reload();
    await expect(players[3].page.getByRole("heading", { name: /第 \d+ 轮 · (?:选择队员|队长选人中)/ })).toBeVisible();

    for (let missionIndex = 0; missionIndex < 3; missionIndex += 1) {
      const publicResponse = await request.get(`/api/rooms/${roomCode}/public`);
      const body = await publicResponse.json() as {
        data: {
          leaderSeat: number;
          missionIndex: number;
          missions: { teamSize: number }[];
        };
      };
      const leaderSeat = body.data.leaderSeat;
      const teamSize = body.data.missions[body.data.missionIndex].teamSize;
      const leaderPage = players[leaderSeat - 1].page;
      await expect(leaderPage.getByRole("heading", { name: `第 ${missionIndex + 1} 轮 · 选择队员` })).toBeVisible();
      await expect(leaderPage.getByText(`请选择 ${teamSize} 名队员`, { exact: true })).toBeVisible();
      if (missionIndex === 0) await expectTeamBuildingLayout(leaderPage, 7, { width: 390, height: 844 });
      const seatButtons = leaderPage.locator(".round-table button.seat");
      await expect(seatButtons).toHaveCount(7);
      if (missionIndex === 0) {
        const observer = players.find((player) => player.page !== leaderPage)!;
        const observerPage = observer.page;
        await seatButtons.nth(0).click();
        await expect(observerPage.locator(".round-table .seat--selected")).toHaveCount(1);
        await expect(board.locator(".board-seat--selected")).toHaveCount(1);
        await reviewIdentity(observerPage, roleBySeat.get(observer.seat)!);
        await expect(observerPage.locator(".round-table .seat--selected")).toHaveCount(1);
        await seatButtons.nth(0).click();
        await expect(observerPage.locator(".round-table .seat--selected")).toHaveCount(0);
        await seatButtons.evaluateAll((buttons, count) => {
          buttons.slice(0, count).forEach((button) => (button as HTMLButtonElement).click());
        }, teamSize);
        await expect(observerPage.locator(".round-table .seat--selected")).toHaveCount(teamSize);
        await expect(board.locator(".board-seat--selected")).toHaveCount(teamSize);
        if (process.env.CAPTURE_VISUAL_QA) {
          await leaderPage.screenshot({ path: "/tmp/avalon-team-building-v3.png", fullPage: true });
          await board.setViewportSize({ width: 1920, height: 1080 });
          await board.screenshot({ path: "/tmp/avalon-board-team-v3.png", fullPage: true });
          await board.setViewportSize({ width: 1440, height: 900 });
        }
      } else {
        for (let index = 0; index < teamSize; index += 1) await seatButtons.nth(index).click();
      }
      await expect(leaderPage.getByRole("button", { name: "确认队伍" })).toBeEnabled();
      await leaderPage.getByRole("button", { name: "确认队伍" }).click();

      await expect(board.getByRole("heading", { name: "请在现场表决这支队伍" })).toBeVisible();
      await expect(page.getByRole("button", { name: "开始同时亮票" })).toHaveCount(0);
      await expect(page.getByRole("timer")).toHaveCount(0);
      const recordVote = leaderPage.getByRole("button", { name: "记录表决结果" });
      const newRecordVote = leaderPage.getByRole("button", { name: "确认现场结果" });
      await expect(recordVote).toHaveCount(0);
      await expect(newRecordVote).toBeEnabled();
      for (const player of players.filter((player) => player.page !== leaderPage)) {
        await expect(player.page.getByRole("button", { name: "确认现场结果" })).toHaveCount(0);
      }
      await newRecordVote.click();

      for (let index = 0; index < teamSize; index += 1) {
        const questPage = players[index].page;
        await expect(questPage.getByRole("heading", { name: "秘密选择一张任务票" })).toBeVisible();
        if (process.env.CAPTURE_VISUAL_QA && missionIndex === 0 && index === 1) {
          await questPage.screenshot({ path: "/tmp/avalon-ballot-final.png", fullPage: true });
        }
        await questPage.getByRole("radio", { name: /任务成功/ }).click();
        await questPage.getByRole("button", { name: "确认任务票" }).click();
      }

      await expect(board.getByRole("heading", { name: "任务票已全部封存" })).toBeVisible();
      const reveal = leaderPage.getByRole("button", { name: "确认并开始揭晓" });
      await expect(reveal).toBeVisible();
      await reveal.click();
      await expect(leaderPage.getByRole("timer")).toBeVisible();
      await expect(board.getByRole("heading", { name: "任务结果即将揭晓" })).toBeVisible();
      await expect(board.getByRole("heading", { name: "任务成功" })).toBeVisible();
      await expect(board.getByText("共出现 0 张失败票")).toBeVisible();
      const continueLabel = missionIndex === 2 ? "进入刺杀阶段" : "进入下一轮";
      const continueButton = page.getByRole("button", { name: continueLabel });
      await expect(continueButton).toBeVisible();
      await continueButton.click();
      await expectBoardHasNoRoles(board);
    }

    await expect(board.getByRole("heading", { name: "刺客，请当面指出梅林" })).toBeVisible();
    const assassinSeat = [...roleBySeat].find(([, role]) => role === "刺客")?.[0];
    const merlinSeat = [...roleBySeat].find(([, role]) => role === "梅林")?.[0];
    if (!assassinSeat || !merlinSeat) throw new Error("未能定位刺客或梅林");
    const assassinPage = players[assassinSeat - 1].page;
    const merlin = players[merlinSeat - 1];
    await expect(assassinPage.getByRole("heading", { name: "指出你认为的梅林" })).toBeVisible();
    await assassinPage.locator(".target-list button").filter({ hasText: merlin.nickname }).click();
    await assassinPage.getByRole("button", { name: "选择这名玩家" }).click();
    await assassinPage.getByRole("button", { name: "确认刺杀" }).click();

    await expect(board.getByRole("heading", { name: "邪恶方获胜" })).toBeVisible();
    await expect(board.locator(".board-role-reveal b")).toHaveCount(7);
    await expect(board.locator(".board-role-reveal").getByText(/· 梅林$/)).toBeVisible();
    await expect(board.locator(".board-role-reveal").getByText(/· 刺客$/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "邪恶方获胜" })).toBeVisible();
    if (process.env.CAPTURE_VISUAL_QA) await board.screenshot({ path: "/tmp/avalon-board-complete.png", fullPage: true });

    await page.getByRole("button", { name: "原座位再来一局" }).click();
    await expect(board.getByRole("heading", { name: "等待所有人记住身份" })).toBeVisible();
    await expect(players[1].page.getByRole("button", { name: "按住查看身份，松手隐藏" })).toBeVisible();
    await expectBoardHasNoRoles(board);
  } finally {
    await Promise.all(extraContexts.map((context) => context.close()));
  }
});

test("手机首页能清楚报错、换座，并在误关后恢复上次桌局", async ({ page, request, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /让秘密留在手机里/ })).toBeVisible();
  if (process.env.CAPTURE_VISUAL_QA) await page.screenshot({ path: "/tmp/avalon-home-final.png", fullPage: true });
  await page.getByRole("button", { name: "加入桌局" }).click();
  await page.getByRole("textbox", { name: "房间号" }).fill("000000");
  await page.getByRole("button", { name: "查看", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("房间不存在或已经过期");

  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations, result.violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);

  const created = await request.post("/api/rooms", {
    data: { nickname: "房主", playerCount: 5, rolePreset: "classic", rejectionRule: "evil-wins" },
  });
  const createdBody = await created.json() as { data: { credentials: Credentials } };
  const roomCode = createdBody.data.credentials.roomCode;
  await page.goto(`/?room=${roomCode}`);
  await expect(page.getByText("1 / 5 已就座")).toBeVisible();
  await page.getByRole("textbox", { name: "你的昵称" }).fill("换座玩家");
  await page.getByRole("button", { name: "确认座位并加入" }).click();
  await expect(page).toHaveURL(new RegExp(`/room/${roomCode}$`));
  await page.getByRole("button", { name: "确认座位并准备" }).click();
  await expect(page.getByRole("button", { name: "取消准备" })).toBeVisible();
  await page.getByRole("button", { name: "换一个座位" }).click();
  await page.locator(".seat-change-panel").getByRole("button", { name: "4" }).click();
  await expect(page.getByRole("button", { name: "确认座位并准备" })).toBeVisible();
  const publicResponse = await request.get(`/api/rooms/${roomCode}/public`);
  const publicBody = await publicResponse.json() as { data: { players: { nickname: string; seat: number }[] } };
  expect(publicBody.data.players.find((player) => player.nickname === "换座玩家")?.seat).toBe(4);

  await page.close();
  const reopened = await context.newPage();
  await reopened.route(`**/api/rooms/${roomCode}/session`, (route) => route.abort("failed"));
  await reopened.goto("/");
  const resume = reopened.getByRole("button", { name: /继续上次桌局/ });
  await expect(resume).toContainText(`房间号 ${roomCode.slice(0, 3)} ${roomCode.slice(3)}`);
  await expect(resume).toContainText("暂时无法确认房间状态");
  expect(await reopened.evaluate((code) => Boolean(localStorage.getItem(`round-table-session:${code}`)), roomCode)).toBe(true);
  await reopened.unroute(`**/api/rooms/${roomCode}/session`);
  await resume.click();
  await expect(reopened).toHaveURL(new RegExp(`/room/${roomCode}$`));
  await expect(reopened.locator(".round-table .seat--current").getByText("4")).toBeVisible();
});

test("两台手机可以通过流程体验走到刺杀与结局", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await page.getByRole("button", { name: "流程体验" }).click();
  await page.getByRole("textbox", { name: "第一位体验者昵称" }).fill("第一台手机");
  await page.getByRole("button", { name: "创建完整流程体验" }).click();
  await expect(page).toHaveURL(/\/room\/\d{6}$/);
  const roomCode = page.url().match(/(\d{6})$/)?.[1];
  if (!roomCode) throw new Error("体验房间没有房间号");
  await expect(page.getByText("4 / 5 已就座")).toBeVisible();
  await expect(page.getByText("第二台手机加入 2 号位")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectGameScreenFits(page, page.getByRole("button", { name: "确认座位并准备" }));
  await page.setViewportSize({ width: 360, height: 640 });

  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const boardContext = await browser.newContext({ viewport: { width: 1451, height: 862 } });
  try {
    let second = await secondContext.newPage();
    await second.goto(`/?room=${roomCode}`);
    await expect(second.getByText("4 / 5 已就座")).toBeVisible();
    await second.getByRole("textbox", { name: "你的昵称" }).fill("第二台手机");
    await second.getByRole("button", { name: "确认座位并加入" }).click();
    await expect(second).toHaveURL(new RegExp(`/room/${roomCode}$`));
    await second.evaluate(() => {
      document.documentElement.style.setProperty("--safe-top", "47px");
      document.documentElement.style.setProperty("--safe-bottom", "34px");
    });

    const board = await boardContext.newPage();
    await board.goto(`/room/${roomCode}/board`);
    await expect(board.getByText("5 / 5 已就座")).toBeVisible();
    await expect(board.getByText("完整流程体验")).toBeVisible();
    await expectGameScreenFits(page, page.getByRole("button", { name: "确认座位并准备" }));
    await expectGameScreenFits(second, second.getByRole("button", { name: "确认座位并准备" }));

    await expect(second.getByRole("button", { name: "房主管理" })).toHaveCount(0);
    await page.getByRole("button", { name: "房主管理" }).click();
    await expect(page.getByRole("dialog", { name: "房主管理" })).toBeVisible();
    await expect(page.getByRole("img", { name: "第二台手机扫码加入 2 号位" })).toBeVisible();
    await expect(page.getByRole("link", { name: "在本机打开玩家加入页" })).toHaveAttribute("href", `/?room=${roomCode}`);
    await page.getByRole("button", { name: "公共屏" }).click();
    await expect(page.getByRole("img", { name: "用另一台设备扫码进入公共屏" })).toBeVisible();
    await expect(page.getByRole("link", { name: "在本机预览公共屏" })).toHaveAttribute("href", `/room/${roomCode}/board`);
    await page.getByRole("button", { name: "关闭房主管理" }).click();

    await page.getByRole("button", { name: "确认座位并准备" }).click();
    await second.getByRole("button", { name: "确认座位并准备" }).click();
    const start = page.getByRole("button", { name: "开始完整流程体验" });
    await expect(start).toBeEnabled();
    await start.click();

    await expectGameScreenFits(page, page.getByRole("button", { name: "按住查看身份，松手隐藏" }));
    await revealAndConfirmRole(page, "梅林");
    await expect(board.getByRole("heading", { name: "等待所有人记住身份" })).toBeVisible();
    await expectGameScreenFits(second, second.getByRole("button", { name: "按住查看身份，松手隐藏" }));
    await revealAndConfirmRole(second, "刺客");
    await expect(board.getByRole("heading", { name: /队长正在选择 \d+ 名队员/ })).toBeVisible();
    await reviewIdentity(second, "刺客");

    for (let mission = 0; mission < 3; mission += 1) {
      if (mission === 0) {
        const confirmTeam = page.getByRole("button", { name: "确认队伍" });
        await expect(page.getByRole("heading", { name: "第 1 轮 · 选择队员" })).toBeVisible();
        await expect(page.getByText("请选择 2 名队员", { exact: true })).toBeVisible();
        await expectTeamBuildingLayout(page, 5, { width: 360, height: 640 });
        await expectSeatNamesFullyVisible(page, {
          seatSelector: ".team-building-stage .seat",
          nameSelector: ".seat__name",
          expectedNames: EXPERIENCE_PLAYER_NAMES,
          context: "360×640 体验组队页",
          maxLines: 1,
        });
        await expectSeatNamesFullyVisible(second, {
          seatSelector: ".team-building-stage .seat",
          nameSelector: ".seat__name",
          expectedNames: EXPERIENCE_PLAYER_NAMES,
          context: "390×844 体验组队页",
          maxLines: 1,
        });
        if (process.env.CAPTURE_VISUAL_QA) {
          await page.screenshot({ path: "/tmp/avalon-team-building-360.png", fullPage: false });
        }
        await expectGameScreenFits(page, confirmTeam);
        await expect(confirmTeam).toBeEnabled();
        await confirmTeam.click();
      } else if (mission === 1) {
        await expect(second.getByRole("heading", { name: "第 2 轮 · 选择队员" })).toBeVisible();
        await expect(second.getByText("请选择 3 名队员", { exact: true })).toBeVisible();
        await expectGameScreenFits(second, second.getByRole("button", { name: "确认队伍" }));
        await second.getByRole("button", { name: /3号 模拟骑士A/ }).click();
        await expect(page.locator(".round-table .seat--selected")).toHaveCount(3);
        if (process.env.CAPTURE_VISUAL_QA) {
          await expect(second.getByRole("button", { name: "确认队伍" })).toBeEnabled();
          await second.waitForTimeout(250);
          await second.screenshot({ path: "/tmp/avalon-team-building-390.png", fullPage: false });
        }
        await second.getByRole("button", { name: "确认队伍" }).click();
      }

      await expect(board.getByRole("heading", { name: "请在现场表决这支队伍" })).toBeVisible();
      const voteRecorder = mission === 1 ? second : page;
      const otherPhone = voteRecorder === page ? second : page;
      const recordVote = voteRecorder.getByRole("button", { name: "确认现场结果" });
      await expect(recordVote).toBeEnabled();
      await expect(otherPhone.getByRole("button", { name: "确认现场结果" })).toHaveCount(0);
      await expectGameScreenFits(voteRecorder, recordVote);
      await recordVote.click();

      await expectGameScreenFits(page, page.getByRole("button", { name: "确认任务票" }));
      await expectGameScreenFits(second, second.getByRole("button", { name: "确认任务票" }));
      if (mission === 0) {
        await expect(page.getByRole("radio", { name: /任务失败/ })).toBeDisabled();
        const evilBallots = second.locator(".ballot-option");
        await expect(evilBallots).toHaveCount(2);
        const visualStyles = await evilBallots.evaluateAll((options) => options.map((option) => {
          const style = getComputedStyle(option);
          return { backgroundColor: style.backgroundColor, borderColor: style.borderColor };
        }));
        expect(new Set(visualStyles.map((style) => style.backgroundColor)).size).toBe(1);
        expect(new Set(visualStyles.map((style) => style.borderColor)).size).toBe(1);
        const orderBeforeReload = await evilBallots.allTextContents();
        await second.close();
        second = await secondContext.newPage();
        await second.goto("/");
        const resume = second.getByRole("button", { name: /继续上次桌局/ });
        await expect(resume).toContainText(`房间号 ${roomCode.slice(0, 3)} ${roomCode.slice(3)}`);
        await resume.click();
        await expect(second).toHaveURL(new RegExp(`/room/${roomCode}$`));
        await expect(second.getByRole("button", { name: "确认任务票" })).toBeVisible();
        expect(await second.locator(".ballot-option").allTextContents()).toEqual(orderBeforeReload);
      }
      await submitSuccessfulQuest(page);
      await expectGameScreenFits(page, page.getByRole("heading", { name: "任务票已封存" }));
      await submitSuccessfulQuest(second);
      if (mission < 2) {
        const leaderPage = mission === 0 ? page : second;
        await expect(board.getByRole("heading", { name: "任务票已全部封存" })).toBeVisible();
        const reveal = leaderPage.getByRole("button", { name: "确认并开始揭晓" });
        await expectGameScreenFits(leaderPage, reveal);
        await expect(reveal).toBeVisible();
        if (mission === 0) {
          await leaderPage.evaluate(() => {
            const actualNow = Date.now.bind(Date);
            Date.now = () => actualNow() + 3_600_000;
          });
        }
        await reveal.click();
        const timer = leaderPage.getByRole("timer");
        await expectGameScreenFits(leaderPage, timer);
        await expect(timer).toContainText(/3|2|1/);
      }
      await expect(board.getByRole("heading", { name: "任务结果即将揭晓" })).toBeVisible();
      if (mission === 2) await expectGameScreenFits(page, page.getByRole("heading", { name: "任务结果即将揭晓" }));
      await expect(board.getByRole("heading", { name: "任务成功" })).toBeVisible();
      const continueLabel = mission === 2 ? "进入刺杀阶段" : "进入下一轮";
      await expectGameScreenFits(page, page.getByRole("button", { name: continueLabel }));
      await page.getByRole("button", { name: continueLabel }).click();
    }

    await expect(second.getByRole("heading", { name: "指出你认为的梅林" })).toBeVisible();
    await expectGameScreenFits(second, second.getByRole("button", { name: /第一台手机/ }));
    await second.locator(".target-list button").filter({ hasText: "第一台手机" }).click();
    await second.getByRole("button", { name: "选择这名玩家" }).click();
    await expectGameScreenFits(second, second.getByRole("button", { name: "确认刺杀" }));
    await second.getByRole("button", { name: "确认刺杀" }).click();
    await expect(board.getByRole("heading", { name: "邪恶方获胜" })).toBeVisible();
    await expect(board.locator(".board-role-reveal b")).toHaveCount(5);
    await expect(page.getByRole("heading", { name: "邪恶方获胜" })).toBeVisible();
    await expectGameScreenFits(page, page.getByRole("button", { name: "原座位再来一局" }));

    await page.getByRole("button", { name: "房主管理" }).click();
    await page.getByRole("button", { name: "结束本局并回到候场" }).click();
    await expect(page.getByRole("alertdialog", { name: "确认结束本局" })).toBeVisible();
    await page.getByRole("button", { name: "确认结束本局" }).click();
    await expect(page.getByText("5 / 5 已就座")).toBeVisible();
    await expect(board.getByText("完整流程体验")).toBeVisible();
    await expect(board.locator(".board-role-reveal")).toHaveCount(0);
  } finally {
    await secondContext.close();
    await boardContext.close();
  }
});

test("两台手机环境下五至十人个人手机组队页在小屏与长姓名下保持清楚可用", async ({ page, request }) => {
  test.setTimeout(180_000);
  const viewports = [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 428, height: 926 },
  ];
  await page.goto("/");
  const origin = new URL(page.url()).origin;

  for (const playerCount of [5, 6, 7, 8, 9, 10]) {
    const created = await request.post("/api/rooms", {
      data: { nickname: MOBILE_LONG_PLAYER_NAMES[0], playerCount, rolePreset: "advanced", rejectionRule: "evil-wins" },
    });
    expect(created.status()).toBe(201);
    const createdBody = await created.json() as { data: { credentials: Credentials } };
    const roomCode = createdBody.data.credentials.roomCode;
    const credentials = [createdBody.data.credentials];
    for (let seat = 2; seat <= playerCount; seat += 1) {
      const joined = await request.post(`/api/rooms/${roomCode}/join`, {
        data: { nickname: MOBILE_LONG_PLAYER_NAMES[seat - 1], seat },
      });
      expect(joined.status()).toBe(201);
      const joinedBody = await joined.json() as { data: { credentials: Credentials } };
      credentials.push(joinedBody.data.credentials);
    }

    const sockets = await Promise.all(credentials.map((entry) => connectPlayerSocket(origin, entry)));
    try {
      const readyResults = await Promise.all(sockets.map((socket) => setPlayerReady(socket)));
      for (const result of readyResults) expect(result.ok, result.error?.message).toBe(true);
      const startResult = await startGame(sockets[0]);
      expect(startResult.ok, startResult.error?.message).toBe(true);
      const identityResults = await Promise.all(sockets.map((socket) => confirmIdentity(socket)));
      for (const result of identityResults) expect(result.ok, result.error?.message).toBe(true);

      const publicResponse = await request.get(`/api/rooms/${roomCode}/public`);
      const publicBody = await publicResponse.json() as { data: { leaderSeat: number; missions: { teamSize: number }[] } };
      const leaderSeat = publicBody.data.leaderSeat;
      const teamSize = publicBody.data.missions[0].teamSize;
      await page.evaluate(({ code, leaderCredentials }) => {
        localStorage.setItem(`round-table-session:${code}`, JSON.stringify(leaderCredentials));
      }, { code: roomCode, leaderCredentials: credentials[leaderSeat - 1] });
      await page.goto(`/room/${roomCode}`);
      await expect(page.getByRole("heading", { name: "第 1 轮 · 选择队员" })).toBeVisible();

      const seatButtons = page.locator(".team-building-stage button.seat");
      await expect(seatButtons).toHaveCount(playerCount);
      await page.locator(`.team-building-stage button.seat[data-seat="${leaderSeat}"]`).click();
      let selectedCount = 1;
      for (let seat = 1; seat <= playerCount && selectedCount < teamSize; seat += 1) {
        if (seat === leaderSeat) continue;
        await page.locator(`.team-building-stage button.seat[data-seat="${seat}"]`).click();
        selectedCount += 1;
      }
      await expect(page.locator(".team-building-stage .seat--selected")).toHaveCount(teamSize);
      await expect(page.locator(".team-building-stage .seat__status")).toHaveCount(0);
      await expect(page.locator(".team-building-stage .seat__check")).toHaveCount(0);
      const leaderSeatPlaque = page.locator(`.team-building-stage .seat[data-seat="${leaderSeat}"]`);
      await expect(leaderSeatPlaque.locator(".seat__leader")).toHaveText("队长");
      await expect(leaderSeatPlaque.locator(".seat__current")).toHaveText("我");

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await expectTeamBuildingLayout(page, playerCount, viewport);
        await expectSeatNamesFullyVisible(page, {
          seatSelector: ".team-building-stage .seat",
          nameSelector: ".seat__name",
          expectedNames: MOBILE_LONG_PLAYER_NAMES.slice(0, playerCount),
          context: `${playerCount} 人个人组队页 ${viewport.width}×${viewport.height}`,
          maxLines: 2,
        });
        await expectGameScreenFits(page, page.getByRole("button", { name: "确认队伍" }));
        if (process.env.CAPTURE_VISUAL_QA && playerCount === 5 && viewport.width === 320) {
          await page.screenshot({ path: "/tmp/avalon-team-building-long-320.png", fullPage: false });
        }
        if (process.env.CAPTURE_VISUAL_QA && playerCount === 10 && viewport.width === 390) {
          await page.screenshot({ path: "/tmp/avalon-team-building-dense-390.png", fullPage: false });
        }
      }

      const observerSeat = leaderSeat === 1 ? 2 : 1;
      await page.evaluate(({ code, observerCredentials }) => {
        localStorage.setItem(`round-table-session:${code}`, JSON.stringify(observerCredentials));
      }, { code: roomCode, observerCredentials: credentials[observerSeat - 1] });
      await page.reload();
      await expect(page.getByRole("heading", { name: "第 1 轮 · 队长选人中" })).toBeVisible();
      await expect(page.locator(".team-building-stage button.seat")).toHaveCount(0);
      await expect(page.getByText("等待本轮队长确认队伍", { exact: true })).toBeVisible();

      await page.evaluate(({ code, hostCredentials }) => {
        localStorage.setItem(`round-table-session:${code}`, JSON.stringify(hostCredentials));
      }, { code: roomCode, hostCredentials: credentials[0] });
      await page.reload();
      await expect(page.getByRole("button", { name: "查看我的身份" })).toBeVisible();
      await expect(page.getByRole("button", { name: "房主管理" })).toBeVisible();
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        const topbarMetrics = await page.evaluate(() => {
          const code = document.querySelector<HTMLElement>(".player-topbar__room-code")!;
          const actions = [...document.querySelectorAll<HTMLElement>(".player-topbar__actions button")];
          const rects = actions.map((action) => action.getBoundingClientRect());
          return {
            roomCodeVisible: code.getBoundingClientRect().width > 0,
            actionSizes: rects.map((rect) => ({ width: rect.width, height: rect.height })),
            actionGap: rects[1].left - rects[0].right,
          };
        });
        expect(topbarMetrics.roomCodeVisible).toBe(true);
        expect(topbarMetrics.actionSizes).toHaveLength(2);
        expect(Math.min(...topbarMetrics.actionSizes.map((size) => size.width))).toBeGreaterThanOrEqual(44);
        expect(Math.min(...topbarMetrics.actionSizes.map((size) => size.height))).toBeGreaterThanOrEqual(44);
        expect(topbarMetrics.actionGap).toBeGreaterThanOrEqual(8);
      }
    } finally {
      sockets.forEach((socket) => socket.disconnect());
    }
  }
});

test("等候阶段可以离开、释放座位并由房主解散房间", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "你的昵称" }).fill("房主");
  await page.locator("form").getByRole("button", { name: "创建桌局" }).click();
  await expect(page).toHaveURL(/\/room\/\d{6}$/);
  const roomCode = page.url().match(/(\d{6})$/)?.[1];
  if (!roomCode) throw new Error("房间没有房间号");

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const boardContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`/?room=${roomCode}`);
    await guest.getByRole("textbox", { name: "你的昵称" }).fill("临时玩家");
    await guest.getByRole("button", { name: "确认座位并加入" }).click();
    const board = await boardContext.newPage();
    await board.goto(`/room/${roomCode}/board`);
    await expect(board.getByText("2 / 7 已就座")).toBeVisible();

    await guest.getByRole("button", { name: "离开房间" }).click();
    await expect(guest.getByRole("alertdialog", { name: "确认离开房间" })).toBeVisible();
    await guest.getByRole("button", { name: "继续等待" }).click();
    await expect(guest.getByRole("button", { name: "离开房间" })).toBeVisible();
    await guest.getByRole("button", { name: "离开房间" }).click();
    await guest.getByRole("button", { name: "确认离开并释放座位" }).click();
    await expect(guest).toHaveURL(/\?notice=left$/);
    await expect(guest.getByRole("status")).toHaveText("你已离开桌局，原座位已经释放。");
    await expect(board.getByText("1 / 7 已就座")).toBeVisible();

    await guest.goto(`/?room=${roomCode}`);
    await guest.getByRole("textbox", { name: "你的昵称" }).fill("重新加入");
    await guest.getByRole("button", { name: "确认座位并加入" }).click();
    await expect(board.getByText("2 / 7 已就座")).toBeVisible();

    await page.getByRole("button", { name: "房主管理" }).click();
    await expect(page.getByRole("img", { name: "玩家扫码选择空座位" })).toBeVisible();
    await expect(page.getByRole("link", { name: "在本机打开玩家加入页" })).toHaveAttribute("href", `/?room=${roomCode}`);
    await page.getByRole("button", { name: "公共屏" }).click();
    await expect(page.getByRole("img", { name: "用另一台设备扫码进入公共屏" })).toBeVisible();
    await page.locator(".host-player-status").getByRole("button", { name: "移出" }).click();
    await page.getByRole("button", { name: "确认移出" }).click();
    await expect(guest).toHaveURL(/\?notice=removed$/);
    await expect(guest.getByRole("status")).toHaveText("你已被房主移出原桌局，可以加入其他房间。");
    await expect(board.getByText("1 / 7 已就座")).toBeVisible();
    await page.getByRole("button", { name: "关闭房主管理" }).click();

    await guest.goto(`/?room=${roomCode}`);
    await guest.getByRole("textbox", { name: "你的昵称" }).fill("再次加入");
    await guest.getByRole("button", { name: "确认座位并加入" }).click();
    await expect(board.getByText("2 / 7 已就座")).toBeVisible();

    // 离线时被房主移出会错过实时通知；恢复网络后仍应清理旧身份并回到加入页。
    await guestContext.setOffline(true);
    await expect(board.getByText("2 / 7 已就座")).toBeVisible();
    await page.getByRole("button", { name: "房主管理" }).click();
    await page.locator(".host-player-status").getByRole("button", { name: "移出" }).click();
    await page.getByRole("button", { name: "确认移出" }).click();
    await expect(board.getByText("1 / 7 已就座")).toBeVisible();
    await guestContext.setOffline(false);
    await expect(guest).toHaveURL(new RegExp(`\\?room=${roomCode}&notice=session-invalid$`));
    await expect(guest.getByRole("status")).toHaveText("原座位已被释放或身份已经失效，请重新选择空座位加入。");
    await page.getByRole("button", { name: "关闭房主管理" }).click();

    await guest.getByRole("textbox", { name: "你的昵称" }).fill("解散前加入");
    await guest.getByRole("button", { name: "确认座位并加入" }).click();
    await expect(board.getByText("2 / 7 已就座")).toBeVisible();

    // 模拟玩家在解散瞬间断网，恢复网络后也应自动离开已经失效的旧页面。
    await guestContext.setOffline(true);

    await page.getByRole("button", { name: "解散房间并重新创建" }).click();
    await expect(page.getByRole("alertdialog", { name: "确认解散房间" })).toBeVisible();
    await page.getByRole("button", { name: "确认解散并返回首页" }).click();
    await expect(page).toHaveURL(/\?notice=dissolved$/);
    await expect(board).toHaveURL(/\?notice=dissolved$/);
    await guestContext.setOffline(false);
    await expect(guest).toHaveURL(/\?notice=unavailable$/);
    await expect(guest.getByRole("status")).toHaveText("原桌局已经结束或失效，可以重新创建或加入其他桌局。");
  } finally {
    await guestContext.close();
    await boardContext.close();
  }
});

test("五至十人公共屏在常见横屏尺寸下中央内容与长姓名都完整可见", async ({ page, request }) => {
  test.setTimeout(180_000);
  const viewports = [
    { width: 1451, height: 862 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1180, height: 820 },
    { width: 1024, height: 768 },
    { width: 900, height: 600 },
    { width: 901, height: 600 },
    { width: 1024, height: 600 },
    { width: 1180, height: 600 },
    { width: 1024, height: 500 },
  ];
  for (const playerCount of [5, 6, 7, 8, 9, 10]) {
    const created = await request.post("/api/rooms", {
      data: { nickname: BOARD_LONG_PLAYER_NAMES[0], playerCount, rolePreset: "advanced", rejectionRule: "evil-wins" },
    });
    const body = await created.json() as { data: { credentials: Credentials } };
    const credentials = [body.data.credentials];
    for (let seat = 2; seat <= playerCount; seat += 1) {
      const joined = await request.post(`/api/rooms/${body.data.credentials.roomCode}/join`, {
        data: { nickname: BOARD_LONG_PLAYER_NAMES[seat - 1], seat },
      });
      expect(joined.status()).toBe(201);
      const joinedBody = await joined.json() as { data: { credentials: Credentials } };
      credentials.push(joinedBody.data.credentials);
    }
    await page.goto(`/room/${body.data.credentials.roomCode}/board`);
    const lobbyContent = page.locator(".board-message--lobby > h1, .board-message--lobby > p, .board-message--lobby > img, .board-message--lobby > span");
    await expect(lobbyContent).toHaveCount(4);
    await expect(page.locator(".board-qr")).toBeVisible();
    await expect.poll(() => page.locator(".board-qr").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(page.locator(".board-message--lobby h1")).toBeVisible();
      await expect(page.locator(".public-board .board-seat__name")).toHaveCount(playerCount);
      await expectSeatNamesFullyVisible(page, {
        seatSelector: ".public-board .board-seat",
        nameSelector: ".board-seat__name",
        expectedNames: BOARD_LONG_PLAYER_NAMES.slice(0, playerCount),
        context: `${playerCount} 人公共屏 ${viewport.width}×${viewport.height}`,
      });
      const viewportMetrics = await page.evaluate(() => {
        const scrolling = document.scrollingElement!;
        const board = document.querySelector<HTMLElement>(".public-board")!.getBoundingClientRect();
        window.scrollTo(0, 9999);
        return {
          scrollHeight: scrolling.scrollHeight,
          clientHeight: scrolling.clientHeight,
          scrollWidth: scrolling.scrollWidth,
          clientWidth: scrolling.clientWidth,
          scrollY: window.scrollY,
          board: { top: board.top, left: board.left, right: board.right, bottom: board.bottom },
        };
      });
      expect(viewportMetrics.scrollHeight).toBeLessThanOrEqual(viewportMetrics.clientHeight + 1);
      expect(viewportMetrics.scrollWidth).toBeLessThanOrEqual(viewportMetrics.clientWidth + 1);
      expect(viewportMetrics.scrollY).toBe(0);
      expect(viewportMetrics.board.top).toBeGreaterThanOrEqual(-1);
      expect(viewportMetrics.board.left).toBeGreaterThanOrEqual(-1);
      expect(viewportMetrics.board.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(viewportMetrics.board.bottom).toBeLessThanOrEqual(viewport.height + 1);
      const visualMetrics = await page.evaluate(() => {
        const seats = [...document.querySelectorAll<HTMLElement>(".public-board .board-seat")].map((seat) => seat.getBoundingClientRect());
        const seatNames = [...document.querySelectorAll<HTMLElement>(".public-board .board-seat__name")];
        const title = document.querySelector<HTMLElement>(".board-message--lobby h1")!;
        const qr = document.querySelector<HTMLElement>(".board-qr")!;
        return {
          seatSpan: Math.max(...seats.map((seat) => seat.right)) - Math.min(...seats.map((seat) => seat.left)),
          seatNameFonts: seatNames.map((name) => Number.parseFloat(getComputedStyle(name).fontSize)),
          titleFont: Number.parseFloat(getComputedStyle(title).fontSize),
          qr: qr.getBoundingClientRect().width,
        };
      });
      expect(
        visualMetrics.seatSpan,
        `${playerCount} 人桌在 ${viewport.width}×${viewport.height} 下座位没有充分利用横向空间`,
      ).toBeGreaterThanOrEqual(viewport.width * 0.7);
      const qrFloor = viewport.width >= 1280 && viewport.height >= 720 ? 140 : 108;
      expect(
        visualMetrics.qr,
        `${viewport.width}×${viewport.height} 下二维码过小`,
      ).toBeGreaterThanOrEqual(qrFloor);
      if (viewport.width >= 1280 && viewport.height >= 720) {
        expect(
          Math.min(...visualMetrics.seatNameFonts),
          `${viewport.width}×${viewport.height} 下公共屏座位名小于 16 像素`,
        ).toBeGreaterThanOrEqual(16);
        expect(
          visualMetrics.titleFont,
          `${viewport.width}×${viewport.height} 下公共屏标题小于 30 像素`,
        ).toBeGreaterThanOrEqual(30);
      }
      const overlapSeats = await page.evaluate(() => {
        const contentElements = [...document.querySelectorAll(".board-message--lobby > h1, .board-message--lobby > p, .board-message--lobby > img, .board-message--lobby > span")];
        const seats = [...document.querySelectorAll(".public-board .board-seat")].map((seat, index) => ({ seat: index + 1, rect: seat.getBoundingClientRect() }));
        const contentRects = contentElements.map((element) => {
          if (element instanceof HTMLImageElement) return { label: "二维码", rect: element.getBoundingClientRect() };
          const range = document.createRange();
          range.selectNodeContents(element);
          return { label: element.tagName.toLowerCase(), rect: range.getBoundingClientRect() };
        });
        const clearance = 8;
        return contentRects.flatMap(({ label, rect }) => seats
          .filter(({ rect: seat }) => (
            rect.left - clearance < seat.right
            && rect.right + clearance > seat.left
            && rect.top - clearance < seat.bottom
            && rect.bottom + clearance > seat.top
          ))
          .map(({ seat }) => `${label}-${seat}`));
      });
      expect(overlapSeats, `${playerCount} 人桌在 ${viewport.width}×${viewport.height} 下中央内容与座位间距不足`).toEqual([]);
    }

    if (playerCount === 10) {
      const sockets = await Promise.all(credentials.map((entry) => connectPlayerSocket(new URL(page.url()).origin, entry)));
      try {
        const readyResults = await Promise.all(sockets.map((socket) => setPlayerReady(socket)));
        for (const result of readyResults) expect(result.ok, result.error?.message).toBe(true);
        const startResult = await startGame(sockets[0]);
        expect(startResult.ok, startResult.error?.message).toBe(true);
        await expect(page.locator(".board-mission-rail")).toBeVisible();
        await expect(page.locator(".board-mission-rail .board-mission-rail__mission")).toHaveCount(5);

        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          const missionFonts = await page.locator(".board-mission-rail .board-mission-rail__mission-title, .board-mission-rail .board-mission-rail__mission-state").evaluateAll((nodes) => (
            nodes.map((node) => Number.parseFloat(getComputedStyle(node).fontSize))
          ));
          expect(
            Math.min(...missionFonts),
            `${viewport.width}×${viewport.height} 下公共屏任务文字小于 14 像素`,
          ).toBeGreaterThanOrEqual(14);
          const activeMetrics = await page.evaluate(() => {
            const scrolling = document.scrollingElement!;
            return {
              heightOverflow: scrolling.scrollHeight - scrolling.clientHeight,
              widthOverflow: scrolling.scrollWidth - scrolling.clientWidth,
              scrollY: window.scrollY,
            };
          });
          expect(activeMetrics.heightOverflow).toBeLessThanOrEqual(1);
          expect(activeMetrics.widthOverflow).toBeLessThanOrEqual(1);
          expect(activeMetrics.scrollY).toBe(0);
        }

        const identityResults = await Promise.all(sockets.map((socket) => confirmIdentity(socket)));
        for (const result of identityResults) expect(result.ok, result.error?.message).toBe(true);
        for (let rejection = 0; rejection < 5; rejection += 1) {
          const publicResponse = await request.get(`/api/rooms/${body.data.credentials.roomCode}/public`);
          const publicBody = await publicResponse.json() as {
            data: {
              phase: string;
              leaderSeat: number;
              missionIndex: number;
              missions: { teamSize: number }[];
              players: { id: string; seat: number }[];
            };
          };
          expect(publicBody.data.phase).toBe("team-building");
          const teamSize = publicBody.data.missions[publicBody.data.missionIndex].teamSize;
          const team = publicBody.data.players
            .slice()
            .sort((first, second) => first.seat - second.seat)
            .slice(0, teamSize)
            .map((player) => player.id);
          const leaderSocket = sockets[publicBody.data.leaderSeat - 1];
          const proposalResult = await proposeTeam(leaderSocket, team);
          expect(proposalResult.ok, proposalResult.error?.message).toBe(true);
          const rejectionResult = await recordTeamVote(leaderSocket, playerCount);
          expect(rejectionResult.ok, rejectionResult.error?.message).toBe(true);
        }

        await expect(page.getByRole("heading", { name: "邪恶方获胜" })).toBeVisible();
        await expect(page.locator(".board-role-reveal b")).toHaveCount(10);
        const completeViewports = [
          { width: 1920, height: 1080 },
          { width: 1024, height: 500 },
          { width: 1280, height: 720 },
        ];
        for (const viewport of completeViewports) {
          await page.setViewportSize(viewport);
          if (process.env.CAPTURE_VISUAL_QA && viewport.width !== 1280) {
            await page.screenshot({
              path: viewport.width === 1024
                ? "/tmp/avalon-board-complete-1024x500.png"
                : "/tmp/avalon-board-complete-1920x1080.png",
              fullPage: false,
            });
          }
          await expectBoardCompleteLayout(page, 10, viewport);
        }
      } finally {
        sockets.forEach((socket) => socket.disconnect());
      }
    }
  }
});

async function expectBoardHasNoRoles(board: Page): Promise<void> {
  await expect(board.locator(".board-role-reveal")).toHaveCount(0);
}

async function expectTeamBuildingLayout(
  page: Page,
  expectedPlayerCount: number,
  expectedViewport: { width: number; height: number },
): Promise<void> {
  const heading = page.locator(".team-building-screen > .team-building-heading");
  const table = page.locator(".team-building-stage .round-table");
  const actionDock = page.locator(".team-building-screen > .phase-action-dock");
  await expect(heading).toBeVisible();
  await expect(table).toBeVisible();
  await expect(actionDock).toBeVisible();

  const metrics = await page.evaluate(() => {
    interface Rect {
      top: number;
      right: number;
      bottom: number;
      left: number;
      width: number;
      height: number;
    }
    const toRect = (element: Element): Rect => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    };
    const union = (rects: Rect[]): Rect => {
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      const left = Math.min(...rects.map((rect) => rect.left));
      return { top, right, bottom, left, width: right - left, height: bottom - top };
    };
    const intersects = (first: Rect, second: Rect): boolean => (
      Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
      * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))
    ) > 1;
    const required = (selector: string): HTMLElement => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`缺少布局区域 ${selector}`);
      return element;
    };

    const headingRect = toRect(required(".team-building-screen > .team-building-heading"));
    const tableElement = required(".team-building-stage .round-table");
    const tableRect = toRect(tableElement);
    const ringRect = toRect(required(".team-building-stage .round-table__wood"));
    const seats = [...tableElement.querySelectorAll<HTMLElement>(".seat")];
    const seatRects = seats.map(toRect);
    const leaderBadges = [...tableElement.querySelectorAll<HTMLElement>(".seat__leader")];
    const selectionMarks = [...tableElement.querySelectorAll<HTMLElement>(".seat__check")];
    const tableVisualRect = union([tableRect, ...seats.map(toRect), ...leaderBadges.map(toRect), ...selectionMarks.map(toRect)]);
    const draftRect = toRect(required(".team-building-stage .team-draft-summary"));
    const actionRect = toRect(required(".team-building-screen > .phase-action-dock"));
    const regions = [
      { label: "阶段标题", rect: headingRect },
      { label: "圆桌视觉范围", rect: tableVisualRect },
      { label: "底部操作区", rect: actionRect },
    ];
    const overlaps: string[] = [];
    for (let first = 0; first < regions.length; first += 1) {
      for (let second = first + 1; second < regions.length; second += 1) {
        if (intersects(regions[first].rect, regions[second].rect)) {
          overlaps.push(`${regions[first].label}-${regions[second].label}`);
        }
      }
    }
    if (intersects(tableVisualRect, draftRect)) overlaps.push("圆桌视觉范围-选人摘要");
    if (intersects(draftRect, actionRect)) overlaps.push("选人摘要-底部操作区");
    const seatOverlaps: string[] = [];
    for (let first = 0; first < seatRects.length; first += 1) {
      for (let second = first + 1; second < seatRects.length; second += 1) {
        if (intersects(seatRects[first], seatRects[second])) seatOverlaps.push(`${first + 1}-${second + 1}`);
      }
    }

    const seatNameFonts = [...tableElement.querySelectorAll<HTMLElement>(".seat__name")]
      .map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    const buttonFonts = [...document.querySelectorAll<HTMLElement>(".team-building-screen button")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((element) => Number.parseFloat(getComputedStyle(element).fontSize));

    return {
      overlaps,
      table: tableRect,
      ring: ringRect,
      layout: tableElement.dataset.layout,
      tableVisual: tableVisualRect,
      seatOverlaps,
      seatSizes: seatRects.map((rect) => ({ width: rect.width, height: rect.height })),
      tableToSummaryGap: draftRect.top - tableVisualRect.bottom,
      summaryToActionGap: actionRect.top - draftRect.bottom,
      seatCount: seats.length,
      leaderBadgeCount: leaderBadges.length,
      seatNameFonts,
      buttonFonts,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });

  expect(metrics.viewport).toEqual(expectedViewport);
  expect(metrics.seatCount).toBe(expectedPlayerCount);
  expect(metrics.leaderBadgeCount).toBe(1);
  expect(metrics.overlaps, "组队页主要区域不应互相覆盖").toEqual([]);
  expect(metrics.seatOverlaps, "手机座位铭牌不应互相覆盖").toEqual([]);
  if (metrics.layout === "radial") {
    expect(Math.abs(metrics.ring.width - metrics.ring.height), "手机圆桌环必须保持正圆").toBeLessThanOrEqual(2);
  } else {
    const denseRatio = metrics.ring.height / metrics.ring.width;
    expect(denseRatio, "密集座位框的纵向比例应保持稳定").toBeGreaterThanOrEqual(1);
    expect(denseRatio, "密集座位框不能被过度拉长").toBeLessThanOrEqual(1.65);
  }
  expect(metrics.table.width, "手机圆桌舞台应充分使用屏幕宽度").toBeGreaterThanOrEqual(expectedViewport.width * 0.9);
  expect(metrics.tableVisual.left).toBeGreaterThanOrEqual(-1);
  expect(metrics.tableVisual.top).toBeGreaterThanOrEqual(-1);
  expect(metrics.tableVisual.right).toBeLessThanOrEqual(metrics.viewport.width + 1);
  expect(metrics.tableVisual.bottom).toBeLessThanOrEqual(metrics.viewport.height + 1);
  expect(metrics.tableToSummaryGap, "圆桌与选择摘要之间不能出现大块断层").toBeLessThanOrEqual(64);
  expect(metrics.summaryToActionGap, "选择摘要与主按钮之间不能出现大块断层").toBeLessThanOrEqual(40);
  expect(Math.min(...metrics.seatSizes.map((size) => size.height)), "座位铭牌触控高度不能小于 48 像素").toBeGreaterThanOrEqual(48);
  expect(Math.min(...metrics.seatNameFonts), "手机圆桌座位名不能小于 12 像素").toBeGreaterThanOrEqual(12);
  expect(Math.min(...metrics.buttonFonts), "组队页按钮文字不能小于 15 像素").toBeGreaterThanOrEqual(15);
}

async function expectSeatNamesFullyVisible(
  page: Page,
  options: {
    seatSelector: string;
    nameSelector: string;
    expectedNames?: string[];
    context: string;
    maxLines?: number;
  },
): Promise<void> {
  const metrics = await page.evaluate(({ seatSelector, nameSelector, maxLines }) => {
    interface Rect {
      top: number;
      right: number;
      bottom: number;
      left: number;
      width: number;
      height: number;
    }
    const toRect = (rect: DOMRect): Rect => ({
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
    const intersects = (first: Rect, second: Rect): boolean => (
      Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
      * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))
    ) > 1;
    const seats = [...document.querySelectorAll<HTMLElement>(seatSelector)];
    const seatRects = seats.map((seat) => toRect(seat.getBoundingClientRect()));
    const names: string[] = [];
    const issues: string[] = [];

    seats.forEach((seat, seatIndex) => {
      const name = seat.querySelector<HTMLElement>(nameSelector);
      if (!name) {
        issues.push(`${seatIndex + 1}号座位缺少姓名元素`);
        return;
      }
      const text = name.textContent?.trim() ?? "";
      names.push(text);
      const style = getComputedStyle(name);
      if (style.textOverflow.toLowerCase() === "ellipsis") issues.push(`${text} 使用了省略号`);
      if (style.whiteSpace.toLowerCase() === "nowrap") issues.push(`${text} 被禁止换行`);
      if (name.scrollWidth > name.clientWidth + 1) {
        issues.push(`${text} 横向内容 ${name.scrollWidth}px 超过容器 ${name.clientWidth}px`);
      }
      if (name.scrollHeight > name.clientHeight + 2) {
        issues.push(`${text} 纵向内容 ${name.scrollHeight}px 超过容器 ${name.clientHeight}px`);
      }

      const range = document.createRange();
      range.selectNodeContents(name);
      const glyphRects = [...range.getClientRects()]
        .map(toRect)
        .filter((rect) => rect.width > 0 && rect.height > 0);
      const lineCount = new Set(glyphRects.map((rect) => Math.round(rect.top))).size;
      if (maxLines && lineCount > maxLines) issues.push(`${text} 使用了 ${lineCount} 行，超过 ${maxLines} 行`);
      if (text && glyphRects.length === 0) issues.push(`${text} 没有可见字形`);
      const ownSeat = seatRects[seatIndex];
      glyphRects.forEach((glyph, lineIndex) => {
        if (
          glyph.left < ownSeat.left - 1
          || glyph.right > ownSeat.right + 1
          || glyph.top < ownSeat.top - 1
          || glyph.bottom > ownSeat.bottom + 1
        ) {
          issues.push(`${text} 第${lineIndex + 1}行超出自己的座位`);
        }
        seatRects.forEach((otherSeat, otherIndex) => {
          if (otherIndex !== seatIndex && intersects(glyph, otherSeat)) {
            issues.push(`${text} 的字形碰到 ${otherIndex + 1}号座位`);
          }
        });
      });
    });

    return { names, issues, seatCount: seats.length };
  }, options);

  expect(metrics.seatCount, `${options.context} 应该渲染座位`).toBeGreaterThan(0);
  for (const expectedName of options.expectedNames ?? []) {
    expect(metrics.names, `${options.context} 缺少完整姓名“${expectedName}”`).toContain(expectedName);
  }
  expect(metrics.issues, `${options.context} 的姓名必须完整显示且不能碰到相邻座位`).toEqual([]);
}

async function expectBoardCompleteLayout(
  page: Page,
  expectedRoleCount: number,
  viewport: { width: number; height: number },
): Promise<void> {
  await expect(page.locator(".board-message--complete")).toBeVisible();
  await expect(page.locator(".board-role-reveal b")).toHaveCount(expectedRoleCount);
  const metrics = await page.evaluate(() => {
    interface Rect {
      top: number;
      right: number;
      bottom: number;
      left: number;
    }
    const textRect = (element: Element): Rect => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    };
    const content = [
      ...[...document.querySelectorAll(".board-message--complete > p, .board-message--complete > strong, .board-message--complete > h1, .board-message--complete > span")]
        .map((element) => ({ label: element.tagName.toLowerCase(), rect: textRect(element) })),
      ...[...document.querySelectorAll(".board-role-reveal b")]
        .map((element, index) => ({ label: `身份${index + 1}`, rect: textRect(element) })),
    ];
    const seats = [...document.querySelectorAll<HTMLElement>(".public-board .board-seat")].map((seat, index) => {
      const rect = seat.getBoundingClientRect();
      return { label: `座位${index + 1}`, rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left } };
    });
    const clearance = 8;
    const round = (value: number) => Math.round(value * 10) / 10;
    const describeRect = (rect: Rect) => ({
      top: round(rect.top),
      right: round(rect.right),
      bottom: round(rect.bottom),
      left: round(rect.left),
    });
    const overlaps = content.flatMap((item) => seats
      .filter((seat) => (
        item.rect.left - clearance < seat.rect.right
        && item.rect.right + clearance > seat.rect.left
        && item.rect.top - clearance < seat.rect.bottom
        && item.rect.bottom + clearance > seat.rect.top
      ))
      .map((seat) => ({
        pair: `${item.label}-${seat.label}`,
        content: describeRect(item.rect),
        seat: describeRect(seat.rect),
        horizontalGap: round(Math.max(item.rect.left - seat.rect.right, seat.rect.left - item.rect.right, 0)),
        verticalGap: round(Math.max(item.rect.top - seat.rect.bottom, seat.rect.top - item.rect.bottom, 0)),
      })));
    const outOfViewport = content
      .filter((item) => (
        item.rect.left < -1
        || item.rect.top < -1
        || item.rect.right > window.innerWidth + 1
        || item.rect.bottom > window.innerHeight + 1
      ))
      .map((item) => item.label);
    const roleFonts = [...document.querySelectorAll<HTMLElement>(".board-role-reveal b")]
      .map((role) => Number.parseFloat(getComputedStyle(role).fontSize));
    const scrolling = document.scrollingElement!;
    window.scrollTo(0, 9999);
    return {
      overlaps,
      outOfViewport,
      roleFonts,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      heightOverflow: scrolling.scrollHeight - scrolling.clientHeight,
      widthOverflow: scrolling.scrollWidth - scrolling.clientWidth,
      scrollY: window.scrollY,
    };
  });

  expect(metrics.viewport).toEqual(viewport);
  expect(metrics.overlaps, `${viewport.width}×${viewport.height} 下结局信息与座位间距不足 8 像素`).toEqual([]);
  expect(metrics.outOfViewport, `${viewport.width}×${viewport.height} 下结局信息超出屏幕`).toEqual([]);
  expect(metrics.heightOverflow).toBeLessThanOrEqual(1);
  expect(metrics.widthOverflow).toBeLessThanOrEqual(1);
  expect(metrics.scrollY).toBe(0);
  if (viewport.width >= 1920 && viewport.height >= 1080) {
    expect(Math.min(...metrics.roleFonts), "1920×1080 结局身份文字不能小于 20 像素").toBeGreaterThanOrEqual(20);
  } else if (viewport.width >= 1280 && viewport.height >= 720) {
    expect(Math.min(...metrics.roleFonts), "1280×720 结局身份文字不能小于 18 像素").toBeGreaterThanOrEqual(18);
  }
}

async function connectPlayerSocket(origin: string, credentials: Credentials): Promise<ClientSocket> {
  const socket = createSocketClient(origin, {
    auth: { roomCode: credentials.roomCode, token: credentials.token, mode: "player" },
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      socket.disconnect();
      reject(error);
    };
    socket.once("connect_error", onError);
    socket.once("connect", () => {
      socket.off("connect_error", onError);
      resolve();
    });
  });
  return socket;
}

async function setPlayerReady(socket: ClientSocket): Promise<CommandResult> {
  return new Promise((resolve) => socket.emit("player:ready", true, resolve));
}

async function startGame(socket: ClientSocket): Promise<CommandResult> {
  return new Promise((resolve) => socket.emit("game:start", resolve));
}

async function confirmIdentity(socket: ClientSocket): Promise<CommandResult> {
  return new Promise((resolve) => socket.emit("identity:confirm", resolve));
}

async function proposeTeam(socket: ClientSocket, team: string[]): Promise<CommandResult> {
  return new Promise((resolve) => socket.emit("team:propose", team, resolve));
}

async function recordTeamVote(socket: ClientSocket, rejectCount: number): Promise<CommandResult> {
  return new Promise((resolve) => socket.emit("team-vote:record", rejectCount, resolve));
}

async function expectGameScreenFits(page: Page, primaryAction: Locator): Promise<void> {
  await expect(primaryAction).toBeVisible();
  await expect(primaryAction).toBeInViewport();
  const primaryBox = await primaryAction.boundingBox();
  expect(primaryBox).not.toBeNull();
  const metrics = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".player-shell > main");
    if (!main) return null;
    const actionElements = [...main.querySelectorAll<HTMLElement>("button, a, input, [role='radio']")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
    const lowestAction = actionElements.reduce((bottom, element) => Math.max(bottom, element.getBoundingClientRect().bottom), 0);
    const clippedControls = actionElements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const clipped = rect.top < -1 || rect.left < -1 || rect.bottom > window.innerHeight + 1 || rect.right > window.innerWidth + 1;
      return clipped ? [element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30) ?? element.tagName] : [];
    });
    return {
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      documentOverflow: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight,
      documentWidthOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      mainOverflow: main.scrollHeight - main.clientHeight,
      lowestAction,
      clippedControls,
    };
  });
  expect(metrics).not.toBeNull();
  expect(primaryBox!.x).toBeGreaterThanOrEqual(-1);
  expect(primaryBox!.y).toBeGreaterThanOrEqual(-1);
  expect(primaryBox!.x + primaryBox!.width).toBeLessThanOrEqual(metrics!.innerWidth + 1);
  expect(primaryBox!.y + primaryBox!.height).toBeLessThanOrEqual(metrics!.innerHeight + 1);
  expect(metrics!.documentOverflow).toBeLessThanOrEqual(1);
  expect(metrics!.documentWidthOverflow).toBeLessThanOrEqual(1);
  expect(metrics!.mainOverflow).toBeLessThanOrEqual(1);
  expect(metrics!.lowestAction).toBeLessThanOrEqual(metrics!.innerHeight + 1);
  expect(metrics!.clippedControls).toEqual([]);
}

async function revealAndConfirmRole(page: Page, expectedRole: string): Promise<void> {
  const hold = page.getByRole("button", { name: "按住查看身份，松手隐藏" });
  await expect(hold).toBeVisible();
  const before = await hold.boundingBox();
  expect(before).not.toBeNull();
  await hold.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true });
  await expect(page.locator(".identity-details h2")).toHaveText(expectedRole);
  const during = await hold.boundingBox();
  expect(during).not.toBeNull();
  expect(Math.abs(during!.y - before!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(during!.height - before!.height)).toBeLessThanOrEqual(1);
  await expectGameScreenFits(page, page.getByRole("button", { name: "我已记住" }));
  await hold.dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", isPrimary: true });
  await page.getByRole("button", { name: "我已记住" }).click();
}

async function reviewIdentity(page: Page, expectedRole: string): Promise<void> {
  await page.getByRole("button", { name: "查看我的身份" }).click();
  const dialog = page.getByRole("dialog", { name: "查看我的身份" });
  await expect(dialog).toBeVisible();
  const hold = dialog.getByRole("button", { name: "按住查看身份，松手隐藏" });
  const before = await hold.boundingBox();
  expect(before).not.toBeNull();
  await hold.dispatchEvent("pointerdown", { pointerId: 9, pointerType: "touch", isPrimary: true });
  await expect(dialog.locator(".identity-details h2")).toHaveText(expectedRole);
  if (process.env.CAPTURE_VISUAL_QA) await page.screenshot({ path: "/tmp/avalon-identity-review.png", fullPage: true });
  const during = await hold.boundingBox();
  expect(during).not.toBeNull();
  expect(Math.abs(during!.y - before!.y)).toBeLessThanOrEqual(1);
  await hold.dispatchEvent("pointerup", { pointerId: 9, pointerType: "touch", isPrimary: true });
  await expect(dialog.locator(".identity-details h2")).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭身份查看" }).click();
  await expect(dialog).toHaveCount(0);
}

async function submitSuccessfulQuest(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "秘密选择一张任务票" })).toBeVisible();
  await page.getByRole("radio", { name: /任务成功/ }).click();
  await page.getByRole("button", { name: "确认任务票" }).click();
}
