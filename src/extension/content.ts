/**
 * MV3 扩展内容脚本入口。
 *
 * 与油猴入口共用同一套核心与 UI（油猴脚本无 grant，本就运行在页面上下文）。
 * 关键：manifest.json 中 content_scripts 必须声明 "world": "MAIN"——
 * 智谱清言（读 Vue store）和元宝（读 window.__NEXT_DATA__）依赖页面 JS 上下文，
 * 默认的 isolated world 看不到页面 JS 属性。
 */
import '../userscript/index';
