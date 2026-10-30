# 状态、证据与交接

优先复用项目已有issue/记录。小修无需另建持久记录，但仍按SKILL.md B节主动汇报路线、关键变化及交付结论；最终消息可合并记录阶段、状态、产物、验收依据、实际证据和缺口。跨会话任务使用`assets/work-record.md`；高风险发布才用runbook；JSON不是所有任务的强制要求。已有记录中的阶段状态、证据与下一动作随实际进展更新，避免对话已回退而文件仍声称通过。

状态含义：未开始=未执行；进行中=正在产生工作；待验证=产物或决定已有、条件未被证实；通过=对应范围的实际证据满足判准；阻塞=关键依赖或授权缺失；不适用=活动确实无关并注明理由。不能把“验收计划通过”写成“产品通过”。阶段、条件和整体任务分别判断。

产品证据最低字段：对象、真实版本（含工作树差异）、环境/数据集、动作与时间、结果、来源位置、执行者、预期依据。00接入用真实请求/上下文快照，不需要不存在的仓库或运行环境。引用只支持它蕴含的断言；测试日志只支持它测试的范围。事实、假设、计划、模拟、执行结果分开。

证据复用：保留原运行的版本/时间，不修改历史。记录本次变更影响分析及旧证据为什么仍适用。相关路径、依赖、配置、数据或工具版本改变则重验。机器检查器严格比对目标元组；需复用时，可以新增一条**实际执行的影响审查观察**，引用旧证据并说明审查结果，但不能伪装新测试执行。关键技术执行条件仍需要适用的真实运行记录；记录器不能自动证明等价。

## 00与后续阶段：不同范围，不相互替代

00记录在同一工作记录中，模板见`assets/work-record.md`；只补任务/现场、上下文复用、事实/假设/未知、能力四态、最小组合与可靠性措施、授权预算、路线与下一动作。连续会话只改变化字段。详细流程按需读`references/intake.md`。

机器结构保持`schema_version: 1`。1.1.0增加00，1.1.1修正未决路线、能力证据绑定与完整接入结论。旧01—15记录不必添加00或新字段；同目标的既有00证据可继续使用。曾靠不相关快照支撑能力的记录需要补真实复用审查或降为未验证，不能改写历史来迁就检查器。阶段枚举仍为00—15，非法编号拒绝；旧任务类型保留。

**目标命名空间：**未写`target_type`时沿用`software`，产品对象/版本/环境仍须真实非空。00判准`kind: intake`、`stage: "00"`的目标为`context`，具有`object`和`snapshot_id`。revision/environment可为null，但分别提供`absence_reasons`；snapshot_id标识当时真实接入快照，不冒充Git commit。软件目标不能借用null规则。已有仓库可在context目标中记实际版本，也可在上下文索引记录；选定方式后证据目标一致。

**接入证据：**context只允许实际observation/human_decision支持通过，须`purpose: intake`、真实本地记录及SHA256，不能标为技术execution。摘要仅对本次实际读取/观察范围作结论，不能把未访问机器写为已配置。snapshot_id变更需相应证据；单凭计划/模拟/引用不能通过。接入记录的事实依据和已读状态是可审查声明，检查器不能自行证明人实际读过材料。

**最小结构：**选择00时增加`intake`对象，记录goal、non_goals、context_index、statements、unknowns、capabilities、strategy、reliability、stop_conditions及route。JSON模板`assets/intake-record.json`是未开始示例，不是用户事实。能力状态英文值映射为：available_verified=已可用且有依据；configured_unverified=已配置但未验证；planned=计划使用（可用性可能未知）；unavailable=当前不可用。仅配置/计划不能支持“下一动作ready”；其他未使用能力缺口不阻塞该动作。

**能力证据的当前范围：**每项能力可省略`verification_target`，缺省采用唯一的当前intake判准目标（判准有`target`则用它，否则用task）；有多个不同接入目标时须显式选择。显式`verification_target`必须匹配当前task或某个当前intake判准目标，不允许把它指向旧快照来绕过核对。`available_verified`至少需要一条有效实际pass证据与此目标匹配，或具有下面的真实复用审查。对象、版本、环境与context快照按共同目标规则匹配；同一时间戳不能代替作用域一致。

**跨目标或快照的能力复用：**在该能力的`reuse_reviews`列出`{evidence_id, review_evidence_id, reason}`。`evidence_id`须是该能力`evidence_ids`中的有效实际pass证据；`review_evidence_id`须为不同记录，指向当前验证目标下实际执行的observation或human_decision/pass审查，并解释旧结论为什么仍适用。context审查仍使用`purpose: intake`，保留实际记录、摘要和原始时间；不能把新审查伪装成新测试execution。计划、模拟、失效审查、错误目标或自我引用不能构成复用依据。程序核对字段、引用与目标绑定，能力含义是否相关、审查是否真实仍需负责者判断。

**准备足够与缺口明确：**route.readiness=ready用于声明该具体下一动作的输入、能力、授权已核；检查器只核可表达的关系，不能独立证明授权真实。gaps_explicit须列具体缺口；路线有依据时00可完成接入范围，但下一动作不宣称可执行。00整体通过或ready时，`route.next_stage`须为01—15，不把00当作循环路线。

**路线尚未确定：**task状态为未开始、进行中、待验证或阻塞，且00整体尚未通过时，允许`route.next_stage: null`；同时须写非空`unresolved_reason`、`readiness: gaps_explicit`、非空`gaps`，以及与`handoff.next_action`一致的具体澄清动作。保留已经验证的接入子条件，不能为了允许null撤销真实结果；也不能把未决路线伪称通过。00整体结论要求至少一个适用intake判准且全部适用intake判准通过，单个子条件通过不够；`intake_claim_consistent`对应这一完整接入声明，仍不是软件正确性证明。

critical条件只针对本接入范围，未知产品价值本身不是00失败。handoff.blockers只登记当前声明范围的阻塞；后续缺口放intake.unknowns/route.gaps，不能删除真正的当前阻塞来制造通过。

**防止范围偷换：**选择00必须有intake判准。后续非intake判准不能使用context目标。只选00的任务通过只证明接入结论；若选择00及其他阶段，整体通过还要求每个后续阶段至少一个标明对应stage的非intake通过条件，且全部适用条件通过。仅context任务不能完成后续阶段。需要记录“00通过而产品未开始”时，整体任务仍未开始/进行中/待验证，给00判准单独的context目标及target_reason；软件目标仍可保持明确的unverified，不能据此通过。

## 硬预算与复盘检查点

`task.budget.max_hypothesis_cycles`、`max_validation_runs`、`max_same_failure_retries`保留旧的非负整数用法；`null`表示未指定这一硬数量上限，不授权无限执行或新增付费。用户/项目明确的费用、时间及其他限制仍须遵守。

可选`review_checkpoints: {hypothesis_cycles: 3, validation_runs: 6}`表示复盘触发建议，值为正整数，不作为自动停止次数。到点检查新证据、下一判别动作和累计消耗；仍在原授权与预算内就记录理由继续，不重复审批、不清零累计计数。没有新证据或硬预算耗尽时停止受影响分支。检查器验证字段结构，不负责运行计数、费用监控或自动执行这些边界。

## 可选JSON检查器

`assets/evidence-record.json`保留旧01—15用法，是有效的未开始模板，不含虚构成功。复制后由任务实际信息填充；`assets/evidence-record.schema.json`说明结构。不要把模板里的任务名当真实项目事实。

在**已选择且提供Python3的适当Nix环境**时运行：有项目优先复用项目/父目录环境，无项目的00检查用现有适当环境或固定输入，不为了检查记录先初始化项目。Python缺失就人工核查，不能绕过环境全局安装。

```sh
# SKILL_DIR需指向已审查的本技能实际目录；RECORD与ROOT由当前记录和证据所在目录确定；ROOT不必是仓库。
python3 "$SKILL_DIR/scripts/check_record.py" "$RECORD" --root "$ROOT"
```

依赖仅Python标准库，Python≥3.10。脚本只读JSON和root内引用的常规证据文件，不运行记录中的命令、不联网、不写项目。输入路径不能逃逸root，符号链接须最终落在root内；记录≤2MiB，单证据≤10MiB。退出0=结构/声明与文件绑定一致，1=记录验证错误，2=输入/使用错误。stdout返回JSON。

检查：字段/状态/引用、目标元组、SHA256、真实证据类型、全部关键条件、数据变更的恢复证据。不会证明日志真实、命令真的执行、预期独立、授权合法或软件正确；没有可信日志签名/宿主审计就不能抗恶意伪造。它不是安全沙箱或宿主hook。

通过条件可以是接入、技术执行、用户观察、价值观察或审查；接入只能用context观察/决定且仅用于00；技术类必须引用execution，用户/价值类须observation或human_decision，review可引用execution/observation/human_decision。simulation、plan、citation从不单独使条件通过。NA不能用于critical条件。所有适用条件均通过且至少有一个适用条件时，整体才可通过。

## 交接

更新：对象/真实版本与环境、已做/未做、命令结果与证据、失败过的假设、预算消耗、授权、风险/例外、下一最小行动。下次会话做00增量核对：有仓库才核验工作树，检查实际可访问的工具运行状态和外部对象；冲突回到最近可靠证据。不能仅凭“上次说通过”继续发布。
