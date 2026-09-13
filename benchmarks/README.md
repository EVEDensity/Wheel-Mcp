# ��ʵ��Ŀ benchmark

��׼��Ŀ���� Godot �ٷ� `godot-demo-projects` �ֿ⣬manifest �̶��� revision `a3b5c113112f77291d5f3d1360f33a882fdc52f7`����Ŀ����λ�� `.harness/benchmark-sources`�������ύ��

```powershell
$env:GODOT_PATH='E:\AI\Godot_v4.7.2-stable_win64_console.exe'
npm run benchmark
```

ÿ����Ŀִ����ʵ MCP Client �� MCP Server����������Ŀ��ȡ��������ȡ��ȫ������������ѡ����߷��سɹ�����Ϊ��Ϸ�߼��޸��ɹ������ `runs/benchmark/latest.json`���� git ���ԣ���

ָ�꣺`requests` �� MCP tool ��������`wireBytes` ���������Ӧ JSON �ֽ�����`estimatedTokens` �� `ceil(wireBytes / 4)` �Ŀ繩Ӧ�� proxy�������˵� token��`durationMs` ��ǽ�Ӻ�ʱ��`retries` ����ȷ���Դ�����

��ǰ benchmark ���� Harness ����ʵ��Ŀ����/������¡��޸��ɹ��ʡ����ʡ�����ʱ���ʡ�����ṩͬһ����ʵȱ�ݺ��˹�ȷ�ϱ�ǩ����ܼ��㣬��ֵ�ȱ���ٷֱȸ��ɿ���
