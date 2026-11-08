/**
 * 诊断用最小模块（探针）。
 *
 * 目的：把「导入链路是否可用」与「主模块内容是否有客户端不接受的地方」分开。
 * 它只有一条参数、一个模块、一个返回空列表的函数，其余全部遵循同一套契约：
 * 顶层 `WidgetMetadata` 对象字面量、点分 id、无 ESM 导出。
 *
 * 生成密文：node scripts/encrypt.mjs --in probe/probe.js --out dist/probe.rex.js
 */
WidgetMetadata = {
  id: "yikr.rex-hub-probe",
  title: "Rex Hub 探针",
  description: "仅用于确认导入链路可用性的最小模块，不请求网络。",
  author: "YikR",
  version: "0.0.1",
  requiredVersion: "0.0.2",
  globalParams: [
    {
      name: "note",
      title: "备注",
      type: "input",
      description: "随便填，用于确认参数是否透传",
      value: "",
    },
  ],
  modules: [
    {
      id: "probe-list",
      title: "探针列表",
      description: "永远返回空列表",
      functionName: "probeList",
      params: [],
    },
  ],
};

function probeList(params) {
  console.warn("[rex-hub-probe] 收到参数:", JSON.stringify(params));
  return [];
}
