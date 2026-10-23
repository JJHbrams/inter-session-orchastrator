import {createClaudeChairRunner} from '../claude/chair.js';
import {createCodexChairRunner} from '../codex/chair.js';
export function createChairRunner({claude=createClaudeChairRunner(),codex=createCodexChairRunner()}={}){
 const select=args=>({claude,codex}[args.provider||'claude'])||null;
 return {initialize:args=>{const runner=select(args);if(!runner)throw Error('지원하지 않는 좌장 provider');return runner.initialize(args);},resume:args=>{const runner=select(args);if(!runner)throw Error('지원하지 않는 좌장 provider');return runner.resume(args);}};
}
