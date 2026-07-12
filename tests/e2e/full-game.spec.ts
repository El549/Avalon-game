import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

test("七人桌局从创建、认身份到刺杀和重开完整可用", async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  const extraContexts: BrowserContext[] = [];

  try {
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
    await expect(board.getByText(/正在组队/)).toBeVisible();
    await expectBoardHasNoRoles(board);

    // 模拟一名玩家刷新页面，确认座位、身份和当前进度都能恢复。
    await players[3].page.reload();
    await expect(players[3].page.getByText(/队长正在组队|选择 \d 名任务队员/)).toBeVisible();

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
      await expect(leaderPage.getByRole("heading", { name: `选择 ${teamSize} 名任务队员` })).toBeVisible();
      const seatButtons = leaderPage.locator(".round-table button.seat");
      await expect(seatButtons).toHaveCount(7);
      if (missionIndex === 0) {
        const observer = players.find((player) => player.page !== leaderPage)!;
        const observerPage = observer.page;
        await seatButtons.nth(0).click();
        await expect(observerPage.locator(".round-table .seat--selected")).toHaveCount(1);
        await expect(board.locator(".round-table .seat--selected")).toHaveCount(1);
        await reviewIdentity(observerPage, roleBySeat.get(observer.seat)!);
        await expect(observerPage.locator(".round-table .seat--selected")).toHaveCount(1);
        await seatButtons.nth(0).click();
        await expect(observerPage.locator(".round-table .seat--selected")).toHaveCount(0);
        await seatButtons.evaluateAll((buttons, count) => {
          buttons.slice(0, count).forEach((button) => (button as HTMLButtonElement).click());
        }, teamSize);
        await expect(observerPage.locator(".round-table .seat--selected")).toHaveCount(teamSize);
        await expect(board.locator(".round-table .seat--selected")).toHaveCount(teamSize);
      } else {
        for (let index = 0; index < teamSize; index += 1) await seatButtons.nth(index).click();
      }
      await expect(leaderPage.getByRole("button", { name: "确认本轮队伍" })).toBeEnabled();
      await leaderPage.getByRole("button", { name: "确认本轮队伍" }).click();

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
    await expect(board.getByText(/正在组队/)).toBeVisible();
    await reviewIdentity(second, "刺客");

    for (let mission = 0; mission < 3; mission += 1) {
      if (mission === 0) {
        const confirmTeam = page.getByRole("button", { name: "确认本轮队伍" });
        await expectGameScreenFits(page, confirmTeam);
        await expect(confirmTeam).toBeEnabled();
        await confirmTeam.click();
      } else if (mission === 1) {
        await expect(second.getByRole("heading", { name: "选择 3 名任务队员" })).toBeVisible();
        await expectGameScreenFits(second, second.getByRole("button", { name: "确认本轮队伍" }));
        await second.getByRole("button", { name: /3号 模拟骑士A/ }).click();
        await expect(page.locator(".round-table .seat--selected")).toHaveCount(3);
        await second.getByRole("button", { name: "确认本轮队伍" }).click();
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

test("五至十人公共屏在常见横屏尺寸下中央内容不会碰到座位", async ({ page, request }) => {
  const viewports = [
    { width: 1451, height: 862 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
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
      data: { nickname: "房主", playerCount, rolePreset: "advanced", rejectionRule: "evil-wins" },
    });
    const body = await created.json() as { data: { credentials: Credentials } };
    await page.goto(`/room/${body.data.credentials.roomCode}/board`);
    const lobbyContent = page.locator(".board-message--lobby > h1, .board-message--lobby > p, .board-message--lobby > img, .board-message--lobby > span");
    await expect(lobbyContent).toHaveCount(4);
    await expect(page.locator(".board-qr")).toBeVisible();
    await expect.poll(() => page.locator(".board-qr").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(page.locator(".board-message--lobby h1")).toBeVisible();
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
      const overlapSeats = await page.evaluate(() => {
        const contentElements = [...document.querySelectorAll(".board-message--lobby > h1, .board-message--lobby > p, .board-message--lobby > img, .board-message--lobby > span")];
        const seats = [...document.querySelectorAll(".public-board .seat")].map((seat, index) => ({ seat: index + 1, rect: seat.getBoundingClientRect() }));
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
  }
});

async function expectBoardHasNoRoles(board: Page): Promise<void> {
  await expect(board.locator(".board-role-reveal")).toHaveCount(0);
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
