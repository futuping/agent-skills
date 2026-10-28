"""Synthetic fixtures only; passing these tests does not validate a user app."""
from __future__ import annotations
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'scripts/check_record.py'
spec=importlib.util.spec_from_file_location('check_record',SCRIPT)
checker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)

class RecordTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name).resolve()
        (self.root/'run.txt').write_text('SYNTHETIC TEST FIXTURE: expected test pass\n')
        digest=hashlib.sha256((self.root/'run.txt').read_bytes()).hexdigest()
        self.record={'schema_version':1,'task':{
            'id':'test-task','kind':'change','object':'fixture','revision':'fixture-rev-1',
            'environment':'isolated-test','execution_owner':'test-runner',
            'acceptance_owner':'test-author','status':'通过','risk':'low',
            'selected_stages':['07','08'],'authorization':{'allowed':['fixture only'],'forbidden':['network']},
            'budget':{'max_hypothesis_cycles':3,'max_validation_runs':6,'max_same_failure_retries':1}},
            'criteria':[{'id':'AC1','statement':'fixture check','kind':'technical','critical':True,
                         'expectation_basis':'synthetic test oracle, not real product evidence',
                         'status':'通过','evidence_ids':['E1']}],
            'evidence':[{'id':'E1','kind':'execution','criterion_ids':['AC1'],'object':'fixture',
                         'revision':'fixture-rev-1','environment':'isolated-test','producer':'test-runner',
                         'timestamp':'2026-10-27T12:00:00+00:00','action':'synthetic fixture',
                         'result':'pass','summary':'test fixture','locator':'run.txt','sha256':digest,
                         'independence':'synthetic fixture only'}],
            'handoff':{'next_action':'none within fixture','blockers':[]}}
    def tearDown(self): self.temp.cleanup()
    def validate(self): return checker.validate_record(self.record,self.root)
    def bad(self,fragment=None):
        result=self.validate(); self.assertFalse(result['record_consistent'], result)
        if fragment: self.assertTrue(any(fragment in x for x in result['errors']),result)
    def test_valid_synthetic_record_not_software_proof(self):
        r=self.validate();self.assertTrue(r['record_consistent'],r);self.assertFalse(r['software_verified'])
    def test_template_pending_valid(self):
        p=SCRIPT.parents[1]/'assets/evidence-record.json'
        r=checker.validate_record(json.loads(p.read_text()),self.root)
        self.assertTrue(r['record_consistent'],r)
    def test_missing_evidence(self): self.record['evidence']=[];self.bad('unknown evidence')
    def test_missing_file(self): (self.root/'run.txt').unlink();self.bad('unreadable')
    def test_bad_hash(self): self.record['evidence'][0]['sha256']='0'*64;self.bad('SHA256')
    def test_stale_revision(self): self.record['evidence'][0]['revision']='old';self.bad('matching')
    def test_wrong_environment(self): self.record['evidence'][0]['environment']='other';self.bad('matching')
    def test_simulation_cannot_pass(self): self.record['evidence'][0]['kind']='simulation';self.bad('actual')
    def test_plan_cannot_pass(self): self.record['evidence'][0]['kind']='plan';self.bad('actual')
    def test_citation_cannot_pass(self): self.record['evidence'][0]['kind']='citation';self.bad('actual')
    def test_user_acceptance_not_technical_execution(self): self.record['criteria'][0]['kind']='user';self.bad('actual')
    def test_actual_human_acceptance_allowed(self):
        self.record['criteria'][0]['kind']='user';self.record['evidence'][0]['kind']='human_decision'
        self.assertTrue(self.validate()['record_consistent'])
    def test_no_criteria_no_pass(self): self.record['criteria']=[];self.record['evidence']=[];self.bad('at least one')
    def test_all_na_no_pass(self):
        c=self.record['criteria'][0];c.update(status='不适用',critical=False,na_reason='fixture only',evidence_ids=[])
        self.record['evidence']=[];self.bad('at least one')
    def test_critical_na(self): self.record['criteria'][0].update(status='不适用',na_reason='not enough time');self.bad('critical')
    def test_pending_criterion_prevents_task_pass(self): self.record['criteria'][0]['status']='待验证';self.bad('not passed')
    def test_failed_run_no_pass(self): self.record['evidence'][0]['result']='fail';self.bad('actual')
    def test_unknown_target_no_pass(self): self.record['task']['revision']='unverified';self.bad('unresolved')
    def test_duplicate_id(self): self.record['evidence'].append(copy.deepcopy(self.record['evidence'][0]));self.bad('duplicate id')
    def test_bad_reverse_reference(self): self.record['evidence'][0]['criterion_ids']=[];self.bad('reverse link')
    def test_reverse_other_direction(self): self.record['criteria'][0]['evidence_ids']=[];self.bad('reverse link')
    def test_timestamp_needs_timezone(self): self.record['evidence'][0]['timestamp']='2026-10-27T00:00:00';self.bad('timezone')
    def test_absolute_evidence_disallowed(self): self.record['evidence'][0]['locator']=str(self.root/'run.txt');self.bad('relative')
    def test_path_escape(self):
        with tempfile.TemporaryDirectory() as other:
            p=Path(other)/'outside.txt';p.write_text('secret')
            self.record['evidence'][0]['locator']='../'+Path(other).name+'/outside.txt';self.bad('escapes root')
    def test_symlink_escape(self):
        with tempfile.TemporaryDirectory() as other:
            p=Path(other)/'outside.txt';p.write_text('secret');(self.root/'link').symlink_to(p)
            self.record['evidence'][0]['locator']='link';self.bad('escapes root')
    def test_symlink_inside_allowed(self):
        (self.root/'inside').symlink_to(self.root/'run.txt');self.record['evidence'][0]['locator']='inside'
        self.assertTrue(self.validate()['record_consistent'])
    def test_directory_not_evidence(self): (self.root/'dir').mkdir();self.record['evidence'][0]['locator']='dir';self.bad('regular')
    def test_large_evidence_rejected(self):
        with (self.root/'run.txt').open('wb') as f: f.truncate(checker.MAX_EVIDENCE+1)
        self.bad('exceeds')
    def test_duplicate_json_keys_rejected(self):
        p=self.root/'record.json';p.write_text('{"a":1,"a":2}')
        with self.assertRaises(checker.InputError): checker.load_record(p,self.root)
    def test_nonfinite_json_rejected(self):
        p=self.root/'record.json';p.write_text('{"a":NaN}')
        with self.assertRaises(checker.InputError): checker.load_record(p,self.root)
    def test_bad_primitive_types_do_not_crash(self):
        self.record['task']['kind']=[];self.record['evidence'][0]['kind']=[]
        self.record['criteria'][0]['kind']=[];self.bad()
    def test_bad_list_items_do_not_crash(self):
        self.record['criteria']=[None];self.record['evidence']=[None];self.bad()
    def test_boolean_not_budget_integer(self): self.record['task']['budget']['max_validation_runs']=True;self.bad('integer')
    def test_highrisk_release_needs_recovery(self):
        self.record['task'].update(risk='high',selected_stages=['10']);self.bad('recovery')
    def test_backup_not_restore(self):
        self.record['task'].update(risk='high',selected_stages=['11'])
        self.record['recovery']={'data_change':True,'strategy':'backup only','restore_evidence_ids':['E1']}
        self.bad('restore')
    def test_restore_fixture_supported(self):
        self.record['task'].update(risk='high',selected_stages=['10'])
        self.record['evidence'][0]['purpose']='restore'
        self.record['recovery']={'data_change':True,'strategy':'synthetic restore fixture','restore_evidence_ids':['E1']}
        self.assertTrue(self.validate()['record_consistent'])
    def test_target_override_requires_reason(self):
        self.record['criteria'][0]['target']={'object':'different','revision':'r','environment':'e'};self.bad('target_reason')
    def test_pass_with_blocker_rejected(self): self.record['handoff']['blockers']=['key blocker'];self.bad('blockers')
    def test_record_outside_root_rejected(self):
        with self.assertRaises(checker.InputError): checker.load_record(SCRIPT,self.root)
    def test_cli_success(self):
        p=self.root/'record.json';p.write_text(json.dumps(self.record))
        out=subprocess.run([sys.executable,str(SCRIPT),str(p),'--root',str(self.root)],capture_output=True,text=True)
        self.assertEqual(out.returncode,0,out.stderr+out.stdout)
        self.assertTrue(json.loads(out.stdout)['record_consistent'])
    def test_cli_invalid_status_returns_one(self):
        self.record['task']['status']='success';p=self.root/'record.json';p.write_text(json.dumps(self.record))
        out=subprocess.run([sys.executable,str(SCRIPT),str(p),'--root',str(self.root)],capture_output=True,text=True)
        self.assertEqual(out.returncode,1,out.stdout)
    def test_cli_missing_input_returns_two(self):
        out=subprocess.run([sys.executable,str(SCRIPT),str(self.root/'missing'),'--root',str(self.root)],capture_output=True,text=True)
        self.assertEqual(out.returncode,2,out.stdout)
    def test_command_field_never_executed(self):
        marker=self.root/'SHOULD_NOT_EXIST'
        self.record['evidence'][0]['action']=f'touch {marker}'
        self.assertTrue(self.validate()['record_consistent']);self.assertFalse(marker.exists())

    def test_unspecified_hard_limits_are_distinct_from_review_checkpoints(self):
        self.record['task']['budget'] = {
            'max_hypothesis_cycles': None, 'max_validation_runs': None,
            'max_same_failure_retries': None,
            'review_checkpoints': {'hypothesis_cycles': 3, 'validation_runs': 6},
        }
        self.assertTrue(self.validate()['record_consistent'])

    def test_missing_hard_limit_is_not_an_explicit_null(self):
        del self.record['task']['budget']['max_validation_runs']
        self.bad('max_validation_runs')

    def test_review_checkpoints_require_positive_integers(self):
        for value in [None, True, 0, -1, 1.5, '6']:
            with self.subTest(value=value):
                self.record['task']['budget']['review_checkpoints'] = {
                    'hypothesis_cycles': 3, 'validation_runs': value}
                self.bad('review_checkpoints')

    def test_review_checkpoints_require_both_intervals(self):
        self.record['task']['budget']['review_checkpoints'] = {'hypothesis_cycles': 3}
        self.bad('review_checkpoints')

    def test_bad_review_checkpoint_container_does_not_crash(self):
        self.record['task']['budget']['review_checkpoints'] = []
        self.bad('review_checkpoints')


class IntakeTests(unittest.TestCase):
    """All passed inputs here are synthetic unit fixtures, never user evidence."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        payload = b'SYNTHETIC FIXTURE: observed a request, no repository/runtime. Not product evidence.\n'
        (self.root / 'context.txt').write_bytes(payload)
        self.target = {'target_type':'context','object':'synthetic request to explore an idea',
                       'revision':None,'environment':None,'snapshot_id':'synthetic-context-snapshot-1',
                       'absence_reasons':{'revision':'Synthetic fixture has no repository.',
                                         'environment':'No runtime is part of this fixture.'}}
        self.record = {'schema_version':1,
            'task':{**self.target,'id':'synthetic-intake','kind':'exploration',
                    'execution_owner':'test-runner','acceptance_owner':'fixture-author',
                    'status':'通过','risk':'low','selected_stages':['00'],
                    'authorization':{'allowed':['inspect fixture'],'forbidden':['install','deploy']},
                    'budget':{'max_hypothesis_cycles':3,'max_validation_runs':6,'max_same_failure_retries':1}},
            'criteria':[{'id':'I00','stage':'00','kind':'intake','statement':'A next exploration step is identified.',
                         'critical':True,'expectation_basis':'Synthetic intake rule, not product acceptance.',
                         'status':'通过','evidence_ids':['E00']}],
            'evidence':[{'id':'E00',**self.target,'kind':'observation','purpose':'intake','criterion_ids':['I00'],
                         'producer':'fixture author','timestamp':'2026-10-28T12:00:00Z',
                         'action':'synthetic observation','result':'pass','summary':'fixture only',
                         'locator':'context.txt','sha256':hashlib.sha256(payload).hexdigest(),
                         'independence':'Fixture tests bookkeeping, not actual task readiness.'}],
            'intake':{
                'goal':'Explore the stated problem before selecting a product.',
                'non_goals':['Do not create a repository or initialize Nix.'],
                'context_index':[{'id':'CTX1','source':'context.txt','version':None,
                    'authority':'synthetic user request','read_scope':'whole fixture',
                    'read_status':'observed','reuse':'reuse request instead of asking again','conflicts':[]}],
                'statements':[{'id':'F1','statement':'The fixture contains an intention, not value validation.',
                               'category':'fact','basis':'context.txt'}],
                'unknowns':[{'id':'U1','question':'Is there a recurring problem?',
                             'impact':'Could change product direction.','blocks':['product choice'],
                             'next_step':'Use existing examples to frame a falsifiable question.'}],
                'capabilities':[{'id':'C1','name':'Read the supplied brief','status':'available_verified',
                                 'basis':'Observed fixture input, not runtime execution.','evidence_ids':['E00']},
                                {'id':'C2','name':'Run project tests','status':'planned',
                                 'basis':'No project exists; availability is unknown.','evidence_ids':[]}],
                'strategy':[{'id':'S1','mechanism':'One agent plus relevant input and external acceptance.',
                             'reason':'No demonstrated need for more tooling.','trigger':'initial exploration',
                             'cost':'one brief review','dependencies':['C1'],
                             'fallback':'Produce a focused question from the visible request.'}],
                'reliability':{'sources':'supplied fixture','premise_check':'intent is not proven demand',
                    'independent_checks':'future user behavior, not model agreement',
                    'uncertainty_and_tool_state':'no unavailable tool execution is claimed'},
                'stop_conditions':['New external authority is required.'],
                'route':{'next_stage':'01','reason':'Value has not been validated.',
                         'next_action':'Frame one falsifiable user-problem question.',
                         'inputs':['supplied request'],'required_capabilities':['C1'],
                         'authorization_basis':'Read-only analysis already allowed.',
                         'verification':'Question is grounded in the supplied request.',
                         'readiness':'ready','gaps':[]}},
            'handoff':{'next_action':'Frame one falsifiable user-problem question.','blockers':[]}}
    def tearDown(self): self.temp.cleanup()
    def validate(self): return checker.validate_record(self.record, self.root)
    def good(self):
        r=self.validate();self.assertTrue(r['record_consistent'],r);return r
    def bad(self, fragment):
        r=self.validate();self.assertFalse(r['record_consistent'],r)
        self.assertTrue(any(fragment in x for x in r['errors']),r)
    def test_no_repository_no_runtime_intake_can_pass(self):
        r=self.good();self.assertTrue(r['intake_claim_consistent']);self.assertFalse(r['software_verified'])
    def test_no_repo_null_requires_reason(self):
        del self.record['task']['absence_reasons']['revision'];self.bad('absence reason')
    def test_no_runtime_null_requires_reason(self):
        del self.record['evidence'][0]['absence_reasons']['environment'];self.bad('absence reason')
    def test_snapshot_required(self): del self.record['task']['snapshot_id'];self.bad('snapshot_id')
    def test_context_snapshot_must_match(self):
        self.record['evidence'][0]['snapshot_id']='another';self.bad('matching')
    def test_context_plan_not_observation(self):
        self.record['evidence'][0]['kind']='plan';self.bad('actual')
    def test_context_simulation_not_observation(self):
        self.record['evidence'][0]['kind']='simulation';self.bad('actual')
    def test_context_execution_is_not_product_run(self):
        self.record['evidence'][0]['kind']='execution';self.bad('cannot be technical execution')
    def test_context_purpose_required(self):
        del self.record['evidence'][0]['purpose'];self.bad('purpose=intake')
    def test_fake_revision_placeholder_rejected(self):
        self.record['task']['revision']='unverified';self.bad('unresolved')
    def test_fake_snapshot_placeholder_rejected(self):
        self.record['task']['snapshot_id']='unknown';self.bad('unresolved')
    def test_intake_does_not_pass_stage01(self):
        self.record['task']['selected_stages'].append('01');self.bad('cannot complete later stages')
    def test_intake_does_not_pass_stage06(self):
        self.record['task']['selected_stages'].append('06');self.bad('cannot replace')
    def test_intake_does_not_pass_stage11(self):
        self.record['task']['selected_stages'].append('11');self.bad('cannot replace')
    def test_intake_pass_while_product_is_pending(self):
        self.record['task'].update(target_type='software',object='uninspected product',revision='unverified',
                                   environment='unverified',status='待验证',selected_stages=['00','01'])
        self.record['criteria'][0].update(target=copy.deepcopy(self.target),target_reason='00 observes the brief, not a product.')
        self.record['criteria'].append({'id':'V01','kind':'value','stage':'01','critical':True,
            'statement':'Observe actual demand','status':'未开始','evidence_ids':[]})
        self.good()
    def test_pending_product_cannot_be_promoted_by_intake(self):
        self.test_intake_pass_while_product_is_pending()
        self.record['task'].update(status='通过',revision='actual-rev',environment='actual-env')
        self.bad('not passed')
    def test_product_criterion_cannot_use_context(self):
        self.record['task']['selected_stages'].append('08')
        self.record['criteria'].append({'id':'P08','kind':'technical','stage':'08','critical':True,
                                       'statement':'product check','status':'待验证','evidence_ids':[]})
        self.bad('product criterion cannot use a context')
    def test_review_cannot_bypass_context_boundary(self):
        self.record['criteria'][0].update(kind='review');self.bad('stage 00 only accepts')
    def test_intake_kind_requires_stage00(self):
        self.record['criteria'][0]['stage']='01';self.bad('requires selected stage 00')
    def test_legacy_01_through15_need_no_intake(self):
        # The separate RecordTests class also reruns the unmodified legacy fixtures.
        old=json.loads((SCRIPT.parents[1]/'assets/evidence-record.json').read_text())
        self.assertTrue(checker.validate_record(old,self.root)['record_consistent'])
    def test_invalid_stages_rejected(self):
        for stage in ['-1','0','16','99',0,None,False]:
            with self.subTest(stage=stage):
                self.record['task']['selected_stages']=[stage];self.bad('00..15')
    def test_duplicate_00_rejected(self):
        self.record['task']['selected_stages']=['00','00'];self.bad('duplicate stage')
    def test_stage_metadata_cannot_be_smuggled_without00(self):
        self.record['task']['selected_stages']=['01'];self.bad('require selecting')
    def test_missing_intake_payload_rejected(self):
        del self.record['intake'];self.bad('intake: object required')
    def test_stage00_needs_criterion(self):
        self.record['criteria']=[];self.bad('at least one intake criterion')
    def test_unread_sources_cannot_complete_intake(self):
        self.record['intake']['context_index'][0]['read_status']='not_read';self.bad('actually read')
    def test_fact_needs_basis(self):
        self.record['intake']['statements'][0]['basis']=None;self.bad('basis')
    def test_assumption_may_be_unproven(self):
        self.record['intake']['statements'][0].update(category='assumption',basis=None);self.good()
    def test_verified_capability_needs_evidence(self):
        self.record['intake']['capabilities'][0]['evidence_ids']=[];self.bad('available_verified requires actual')
    def test_configured_is_not_ready(self):
        self.record['intake']['capabilities'][0]['status']='configured_unverified';self.bad('ready action cannot')
    def test_unavailable_is_not_ready(self):
        self.record['intake']['capabilities'][0]['status']='unavailable';self.bad('ready action cannot')
    def test_planned_is_not_ready(self):
        self.record['intake']['capabilities'][0]['status']='planned';self.bad('ready action cannot')
    def test_explicit_gaps_do_not_block_intake_scope(self):
        self.record['intake']['capabilities'][0]['status']='configured_unverified'
        self.record['intake']['route'].update(readiness='gaps_explicit',gaps=['Verify input access before the next action.'])
        self.good()
    def test_empty_gap_claim_rejected(self):
        self.record['intake']['route']['readiness']='gaps_explicit';self.bad('concrete gaps')
    def test_unknown_tool_does_not_block_unrelated_analysis(self):
        self.record['intake']['capabilities'][1]['status']='unavailable';self.good()
    def test_all_four_capability_states(self):
        for state in checker.CAPABILITY_STATES:
            with self.subTest(state=state):
                c=self.record['intake']['capabilities'][1];c.update(status=state,evidence_ids=['E00'] if state=='available_verified' else [])
                self.good()
    def test_unknown_capability_state_rejected(self):
        self.record['intake']['capabilities'][1]['status']='probably-installed';self.bad('capability state')
    def test_strategy_dependency_must_exist(self):
        self.record['intake']['strategy'][0]['dependencies']=['missing'];self.bad('unknown capability dependency')
    def test_unknown_required_capability_rejected(self):
        self.record['intake']['route']['required_capabilities']=['missing'];self.bad('unknown required capability')
    def test_route_cannot_loop_preparation_forever(self):
        self.record['intake']['route']['next_stage']='00';self.bad('not a preparation loop')
    def test_next_action_must_agree_with_handoff(self):
        self.record['handoff']['next_action']='Deploy now';self.bad('agree with handoff')
    def test_actual_file_required_for_intake_pass(self):
        (self.root/'context.txt').unlink();self.bad('unreadable')
    def test_recorded_kind_coverage(self):
        for kind in ['exploration','new_project','existing_project','change','bugfix','incident','maintenance','evaluation','retirement']:
            with self.subTest(kind=kind): self.record['task']['kind']=kind;self.good()
    def test_bad_metadata_shapes_do_not_crash(self):
        for field in ['context_index','statements','unknowns','capabilities','strategy','reliability','route']:
            with self.subTest(field=field):
                old=self.record['intake'][field];self.record['intake'][field]=None
                self.bad(field);self.record['intake'][field]=old
    def test_bad_capability_state_type_does_not_crash(self):
        self.record['intake']['capabilities'][0]['status']=[];self.bad('capability state')
    def test_null_is_never_valid_for_software_target(self):
        self.record['task']['target_type']='software';self.bad('non-empty string')
    def test_context_snapshot_after_change_requires_new_evidence(self):
        self.record['task']['snapshot_id']='new-observation';self.bad('matching')
    def test_explicit_stage_on_legacy_records_still_validated(self):
        self.record['criteria'][0]['stage']='16';self.bad('00..15')
    def test_unverified_intake_can_remain_pending_without_actual_evidence(self):
        self.record['task']['status']='未开始';self.record['criteria'][0].update(status='未开始',evidence_ids=[])
        self.record['evidence']=[]
        self.record['intake']['capabilities'][0].update(status='planned',evidence_ids=[])
        self.record['intake']['route'].update(readiness='gaps_explicit',gaps=['Read the real request.'])
        r=self.good();self.assertFalse(r['intake_claim_consistent'])
    def test_no_actions_executed_from_intake(self):
        marker=self.root/'DO_NOT_CREATE'
        action=f'touch {marker}'
        self.record['intake']['route']['next_action']=action;self.record['handoff']['next_action']=action
        self.good();self.assertFalse(marker.exists())

    def unresolved_route(self, status='阻塞'):
        self.record['task']['status'] = status
        self.record['criteria'][0].update(status=status, evidence_ids=[])
        self.record['evidence'][0]['criterion_ids'] = []
        action = 'Clarify whether the request is a repair, maintenance, or retirement.'
        self.record['intake']['route'].update(
            next_stage=None, readiness='gaps_explicit',
            unresolved_reason='The task direction is not yet specified.',
            gaps=['Need the requested outcome before choosing a later stage.'],
            next_action=action)
        self.record['handoff'].update(next_action=action, blockers=['Task direction is unknown.'])

    def test_pending_intake_may_leave_next_stage_unknown(self):
        for status in ['未开始', '进行中', '待验证', '阻塞']:
            with self.subTest(status=status):
                self.unresolved_route(status)
                result = self.good()
                self.assertFalse(result['intake_claim_consistent'])

    def test_unknown_route_requires_its_reason(self):
        self.unresolved_route()
        del self.record['intake']['route']['unresolved_reason']
        self.bad('unresolved_reason')

    def test_unknown_route_requires_concrete_gaps(self):
        self.unresolved_route()
        self.record['intake']['route']['gaps'] = []
        self.bad('concrete gaps')

    def test_unknown_route_cannot_be_ready(self):
        self.unresolved_route()
        self.record['intake']['route']['readiness'] = 'ready'
        self.bad('unresolved route')

    def test_passed_intake_cannot_have_unknown_route(self):
        self.record['intake']['route'].update(
            next_stage=None, readiness='gaps_explicit', gaps=['Choose a direction.'],
            unresolved_reason='Not yet selected.')
        self.bad('unresolved route')

    def test_partial_intake_pass_can_keep_route_unresolved(self):
        self.unresolved_route('进行中')
        self.record['criteria'].append({
            'id': 'PARTIAL', 'stage': '00', 'kind': 'intake', 'critical': True,
            'statement': 'The supplied request has been observed.',
            'expectation_basis': 'A real fixture observation supports only this subcondition.',
            'status': '通过', 'evidence_ids': ['E00']})
        self.record['evidence'][0]['criterion_ids'] = ['PARTIAL']
        result = self.good()
        self.assertFalse(result['intake_claim_consistent'])

    def test_partial_intake_pass_still_checks_each_passed_condition(self):
        self.test_partial_intake_pass_can_keep_route_unresolved()
        self.record['evidence'][0]['kind'] = 'plan'
        self.bad('requires valid actual evidence')

    def test_intake_claim_requires_all_applicable_intake_criteria(self):
        self.record['task']['status'] = '进行中'
        self.record['criteria'].append({
            'id': 'PENDING', 'stage': '00', 'kind': 'intake', 'critical': False,
            'statement': 'Task direction still needs clarification.',
            'status': '待验证', 'evidence_ids': []})
        self.assertFalse(self.good()['intake_claim_consistent'])

    def test_nonapplicable_optional_intake_does_not_block_complete_intake(self):
        self.record['criteria'].append({
            'id': 'NA', 'stage': '00', 'kind': 'intake', 'critical': False,
            'statement': 'Existing repository state.', 'status': '不适用',
            'na_reason': 'No repository exists in this fixture.', 'evidence_ids': []})
        self.assertTrue(self.good()['intake_claim_consistent'])

    def test_unknown_route_is_not_valid_for_not_applicable_task(self):
        self.unresolved_route()
        self.record['task']['status'] = '不适用'
        self.bad('unresolved route')

    def test_unknown_route_with_malformed_task_status_does_not_crash(self):
        self.unresolved_route()
        self.record['task']['status'] = []
        self.bad('unsupported status')

    def test_unknown_route_requires_consistent_handoff(self):
        self.unresolved_route()
        self.record['handoff']['next_action'] = 'Implement an unspecified feature.'
        self.bad('agree with handoff')

    def test_missing_next_stage_is_not_an_explicit_null(self):
        self.unresolved_route()
        del self.record['intake']['route']['next_stage']
        self.bad('next_stage')

    def add_old_capability_evidence(self):
        old = copy.deepcopy(self.record['evidence'][0])
        old.update(id='OLD', snapshot_id='previous-context-snapshot', criterion_ids=[])
        self.record['evidence'].append(old)
        self.record['intake']['capabilities'][0]['evidence_ids'] = ['OLD']

    def add_reuse_review(self):
        self.add_old_capability_evidence()
        review = copy.deepcopy(self.record['evidence'][0])
        review.update(id='REUSE', criterion_ids=[],
                      action='Observe changes and assess whether the previous capability proof still applies.')
        self.record['evidence'].append(review)
        self.record['intake']['capabilities'][0]['reuse_reviews'] = [{
            'evidence_id': 'OLD', 'review_evidence_id': 'REUSE',
            'reason': 'The synthetic source and read capability are unchanged; only the intake snapshot advanced.'}]

    def test_capability_cannot_use_unreviewed_other_snapshot(self):
        self.add_old_capability_evidence()
        self.bad('matching its verification target')

    def test_verified_capability_can_reuse_evidence_after_actual_scope_review(self):
        self.add_reuse_review()
        self.good()

    def test_reuse_does_not_rewrite_the_original_target_or_time(self):
        self.add_reuse_review()
        before = copy.deepcopy(self.record['evidence'][1])
        self.good()
        self.assertEqual(self.record['evidence'][1], before)

    def test_reuse_review_must_match_current_scope(self):
        self.add_reuse_review()
        self.record['evidence'][2]['snapshot_id'] = 'other-review-snapshot'
        self.bad('reuse review')

    def test_reuse_review_cannot_be_plan_simulation_citation_or_execution(self):
        for kind in ['plan', 'simulation', 'citation', 'execution']:
            with self.subTest(kind=kind):
                saved = copy.deepcopy(self.record)
                self.add_reuse_review()
                self.record['evidence'][2]['kind'] = kind
                self.bad('reuse review')
                self.record = saved

    def test_reuse_review_cannot_be_failed(self):
        self.add_reuse_review()
        self.record['evidence'][2]['result'] = 'fail'
        self.bad('reuse review')

    def test_reuse_review_requires_a_distinct_evidence_id(self):
        self.add_reuse_review()
        self.record['intake']['capabilities'][0]['reuse_reviews'][0]['review_evidence_id'] = 'OLD'
        self.bad('distinct')

    def test_reuse_review_requires_declared_capability_evidence(self):
        self.add_reuse_review()
        self.record['intake']['capabilities'][0]['reuse_reviews'][0]['evidence_id'] = 'E00'
        self.bad('capability evidence_ids')

    def test_reuse_review_requires_nonempty_reason(self):
        self.add_reuse_review()
        self.record['intake']['capabilities'][0]['reuse_reviews'][0]['reason'] = ' '
        self.bad('reason')

    def test_reuse_review_rejects_missing_evidence(self):
        self.add_reuse_review()
        self.record['intake']['capabilities'][0]['reuse_reviews'][0]['review_evidence_id'] = 'missing'
        self.bad('reuse review')

    def test_invalid_reuse_container_and_entries_do_not_crash(self):
        for value in [None, {}, [None], [{'evidence_id': [], 'review_evidence_id': [], 'reason': 'bad'}]]:
            with self.subTest(value=value):
                self.record['intake']['capabilities'][0]['reuse_reviews'] = value
                self.bad('reuse_reviews')

    def test_explicit_verification_target_accepts_current_context(self):
        self.record['intake']['capabilities'][0]['verification_target'] = copy.deepcopy(self.target)
        self.good()

    def test_explicit_verification_target_cannot_relabel_old_context_as_current(self):
        self.add_old_capability_evidence()
        self.record['intake']['capabilities'][0]['verification_target'] = {
            **self.target, 'snapshot_id': 'previous-context-snapshot'}
        self.bad('current task or intake target')

    def test_verification_target_bad_shape_does_not_crash(self):
        self.record['intake']['capabilities'][0]['verification_target'] = []
        self.bad('verification_target')

    def test_ambiguous_intake_targets_require_explicit_capability_target(self):
        second = {**self.target, 'snapshot_id': 'second-context'}
        self.record['task']['status'] = '进行中'
        self.record['criteria'].append({
            'id': 'I02', 'stage': '00', 'kind': 'intake', 'statement': 'Second context is pending.',
            'critical': False, 'status': '待验证', 'evidence_ids': [],
            'target': second, 'target_reason': 'Separate supplied request.'})
        self.bad('ambiguous')
        self.record['intake']['capabilities'][0]['verification_target'] = copy.deepcopy(self.target)
        self.good()

    def add_nonapplicable_old_intake_target(self):
        old = {**self.target, 'snapshot_id': 'previous-context-snapshot'}
        self.record['criteria'].append({
            'id': 'OLD-NA', 'stage': '00', 'kind': 'intake', 'critical': False,
            'statement': 'An unrelated historical intake is out of scope.',
            'status': '不适用', 'na_reason': 'Historical context is not part of this intake.',
            'target': old, 'target_reason': 'Historical context only.', 'evidence_ids': []})
        return old

    def test_nonapplicable_intake_does_not_make_current_scope_ambiguous(self):
        self.add_nonapplicable_old_intake_target()
        self.good()

    def test_nonapplicable_old_target_cannot_authorize_capability_scope(self):
        old = self.add_nonapplicable_old_intake_target()
        self.add_old_capability_evidence()
        self.record['intake']['capabilities'][0]['verification_target'] = old
        self.bad('current task or intake target')

    def test_explicit_capability_target_can_use_current_software_target(self):
        software = {'target_type': 'software', 'object': 'current synthetic app',
                    'revision': 'current-fixture-revision', 'environment': 'isolated-fixture-runtime'}
        self.record['task'].update(software)
        self.record['criteria'][0].update(target=copy.deepcopy(self.target),
                                          target_reason='Intake observes context, not the software target.')
        runtime = copy.deepcopy(self.record['evidence'][0])
        runtime.update(software)
        runtime.update(id='RUNTIME', kind='execution', purpose='capability', criterion_ids=[])
        self.record['evidence'].append(runtime)
        self.record['intake']['capabilities'][0].update(
            verification_target=software, evidence_ids=['RUNTIME'])
        self.good()

@unittest.skipUnless(importlib.util.find_spec('jsonschema'), 'Optional schema-contract tests require jsonschema.')
class SchemaContractTests(unittest.TestCase):
    """Use the same public record cases at both validation boundaries."""
    def setUp(self):
        from jsonschema import Draft202012Validator, FormatChecker
        self.schema = json.loads((SCRIPT.parents[1] / 'assets/evidence-record.schema.json').read_text())
        Draft202012Validator.check_schema(self.schema)
        self.validator = Draft202012Validator(self.schema, format_checker=FormatChecker())
        self.case = IntakeTests()
        self.case.setUp()

    def tearDown(self):
        self.case.tearDown()

    def accepted(self):
        self.assertEqual(list(self.validator.iter_errors(self.case.record)), [])
        self.case.good()

    def rejected(self):
        self.assertTrue(list(self.validator.iter_errors(self.case.record)))
        result = self.case.validate()
        self.assertFalse(result['record_consistent'], result)

    def test_unresolved_route_states_agree(self):
        for status in ['未开始', '进行中', '待验证', '阻塞']:
            with self.subTest(status=status):
                self.case.unresolved_route(status)
                self.accepted()

    def test_partial_intake_may_keep_route_unresolved(self):
        self.case.test_partial_intake_pass_can_keep_route_unresolved()
        self.accepted()

    def test_completed_intake_cannot_keep_route_unresolved(self):
        self.case.record['task']['status'] = '进行中'
        self.case.record['intake']['route'].update(
            next_stage=None, readiness='gaps_explicit',
            gaps=['Select the next stage.'], unresolved_reason='No route chosen.')
        self.rejected()

    def test_unresolved_route_requires_reason_gaps_and_unfinished_task(self):
        self.case.unresolved_route()
        original = copy.deepcopy(self.case.record)
        for path, value in [
            (('intake', 'route', 'unresolved_reason'), ''),
            (('intake', 'route', 'gaps'), []),
            (('intake', 'route', 'readiness'), 'ready'),
            (('task', 'status'), '通过'),
            (('task', 'status'), '不适用'),
        ]:
            with self.subTest(path=path, value=value):
                self.case.record = copy.deepcopy(original)
                target = self.case.record
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                self.rejected()

    def test_reuse_review_contract(self):
        self.case.add_reuse_review()
        self.accepted()
        self.case.record['intake']['capabilities'][0]['reuse_reviews'][0]['reason'] = ' '
        self.rejected()

    def test_verification_target_contract(self):
        self.case.record['intake']['capabilities'][0]['verification_target'] = copy.deepcopy(self.case.target)
        self.accepted()
        self.case.record['intake']['capabilities'][0]['verification_target'] = None
        self.rejected()

    def test_optional_budget_limits_and_review_intervals(self):
        self.case.record['task']['budget'] = {
            'max_hypothesis_cycles': None, 'max_validation_runs': None,
            'max_same_failure_retries': None,
            'review_checkpoints': {'hypothesis_cycles': 3, 'validation_runs': 6},
        }
        self.accepted()
        self.case.record['task']['budget']['review_checkpoints']['hypothesis_cycles'] = True
        self.rejected()

    def test_legacy_record_remains_valid(self):
        self.case.record = json.loads((SCRIPT.parents[1] / 'assets/evidence-record.json').read_text())
        self.accepted()


if __name__=='__main__': unittest.main(verbosity=2)
