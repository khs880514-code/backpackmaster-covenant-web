# 용량 줄이기 도구

작업자가 내보낸 `.glb` 파일은 100MB가 넘어서 채팅으로 올릴 수 없습니다.
이 폴더의 도구를 PC에서 한 번 돌리면 **2~5MB 정도로 줄어듭니다.**

## 쓰는 법 (Windows) — 내려받을 파일 없음

1. 시작 버튼에 **powershell** 이라고 치고 **Windows PowerShell** 을 엽니다
2. 아래 한 줄을 **붙여넣고 Enter**:

```powershell
irm https://raw.githubusercontent.com/khs880514-code/backpackmaster-covenant-web/claude/production-g-lgo5o8/tools/shrink-glb.ps1 | iex
```

3. `.glb` 파일을 **그 창으로 끌어다 놓고** Enter, 다 넣었으면 빈 Enter 한 번 더

원본 옆에 `이름.small.glb` 가 생깁니다. **그 파일을 올려 주세요.** 원본은 건드리지 않습니다.

처음 한 번은 필요한 도구를 내려받느라 몇 분 걸립니다. 그 다음부터는 바로 돌아갑니다.
Node.js가 없으면 받는 곳을 알려주고 멈춥니다.

### 왜 .bat 이 아닌가

GitHub은 `.bat` 을 `content-type: text/plain` 으로 내려보냅니다. 그래서 Windows가
`.txt` 를 붙여 **메모장 파일로 저장해 버립니다.** `shrink-glb.bat` 도 같이 두었지만,
받으시려면 저장 후 파일 이름 끝의 `.txt` 를 지워야 합니다. 위의 PowerShell 방식은
파일을 저장하지 않으므로 그 문제가 없습니다.

## 무엇을 하는가

게임 빌드가 쓰는 것과 **똑같은 축소 과정**입니다. 새로 만든 게 아니라
`ten-hits/scripts/` 의 두 단계를 한 파일로 합친 것뿐입니다.

1. 화면에 나오지 않는 작업용 노드(`MED_*`, `LATEST_MEDICAL_*`)를 떼어냄
2. 내보내기 오류 수정 — 몸에 검은 구멍을 내는 알파 모드, 노멀 슬롯에 잘못 물린 컬러맵
3. 남은 찌꺼기 정리 + 중복 제거
4. 텍스처를 1K WebP로
5. 정점 데이터를 meshopt로 압축

검증: 이미 게임에 들어가 있는 `pose-11`의 원본 9.77MB를 이 도구로 돌린 결과가
0.76MB로, 게임이 쓰는 파일과 애니메이션 채널 87개·폴리곤 44,066개·스킨 15개까지
전부 같았습니다.

## 리눅스/맥에서

```sh
cd ten-hits && npm install
node ../tools/shrink-glb.mjs /경로/파일.glb
```
