# WSL2 장애 보고서

## 개요

특정 Python 프로그램 실행 중 WSL2가 비정상 종료된 이후 Ubuntu 배포판이 실행되지 않는 문제 발생.

## 환경

* WSL Version: 2.7.8.0
* Kernel Version: 6.18.33.1-1
* Distribution: Ubuntu (WSL2)
* VHDX 위치: `F:\wsl2\Ubuntu\ext4.vhdx`
* VHDX 크기: 약 750GB

## 증상

WSL 실행 시 아래 오류 발생:

```text
getpwnam(wsl) failed 5
getpwuid(1000) failed 5
getpwuid(0) failed 5
I/O error @util.cpp:1399 (UtilInitGroups)
Create process failed
```

또한 WSL이 Ubuntu 인스턴스를 시작하지 못함.

## 추가 확인 결과

### WSL 상태

```text
wsl -l -v

NAME      STATE    VERSION
Ubuntu    Running  2
```

### VHDX 마운트 실패

```text
wsl -u root

디스크 'F:\wsl2\Ubuntu\ext4.vhdx'을(를) WSL2에 연결하지 못함
오류 코드: 0x800701b1
```

### Hyper-V VHD 마운트 실패

```powershell
Mount-VHD -Path "F:\wsl2\Ubuntu\ext4.vhdx" -ReadOnly
```

결과:

```text
가상 디스크를 탑재하지 못했습니다.
오류 코드: 0x800701B1
```

### VHD 정보 조회 실패

```powershell
Get-VHD -Path "F:\wsl2\Ubuntu\ext4.vhdx"
```

결과:

```text
탑재된 저장소 인스턴스를 가져오지 못했습니다.
```

### WSL Export 실패

```powershell
wsl --export Ubuntu D:\ubuntu_backup.tar
```

결과:

```text
디스크 'F:\wsl2\Ubuntu\ext4.vhdx'을(를) WSL2에 연결하지 못함
오류 코드: 0x800701b1
```

## 저장장치 상태

* F: 드라이브 NTFS 정상 인식
* SSD HealthStatus: Healthy
* Windows에서 ext4.vhdx 파일 접근 가능

## 추정 원인

Python 작업 중 비정상 종료 또는 시스템 자원 부족으로 인해 WSL2 가상 디스크(`ext4.vhdx`)가 손상된 것으로 추정됨.

특히 Hyper-V 계층에서 VHDX 자체를 마운트하지 못하고 있어 일반적인 Linux 파일시스템(ext4) 손상보다 VHDX 메타데이터 또는 가상 디스크 구조 손상 가능성이 높음.

## 영향

* Ubuntu 배포판 실행 불가
* root 계정 접근 불가
* WSL Export 불가
* VHDX 직접 마운트 불가

## 권장 조치

1. ext4.vhdx 원본 백업
2. VHDX 복구 또는 데이터 추출 시도
3. 복구 실패 시 Ubuntu 재설치 및 데이터 복원


재부팅으로 해결됐다는 사실 자체가 꽤 중요한 단서입니다.

만약 진짜 ext4.vhdx가 손상됐다면 재부팅만으로는 거의 복구되지 않습니다. 지금 보면 실제 원인은:

Docker → WSL2 → Claude Agent 다중 프로세스 → 메모리/IO 폭주 → Hyper-V 또는 WSL 서비스 비정상 상태

에 더 가까워 보입니다.

그리고 사양을 보면:

5950X (16C/32T)
RAM 128GB
RTX 4090
WSL2
Docker
Agent spawning

인데도 프리즈가 난다는 건 단순 성능 부족이 아니라 리소스 제어가 없는 상태에서 폭주하는 패턴일 가능성이 높습니다.

가장 먼저 해야 할 것
1. Docker 컨테이너에 메모리 제한

에이전트 스폰 프로젝트에서 제일 위험한 게 이겁니다.

예:

services:
  agent:
    mem_limit: 32g
    cpus: 12

또는

docker run \
  --memory=32g \
  --cpus=12

지금 상태는 아마

Agent
 ├ Claude
 ├ Claude
 ├ Claude
 ├ Claude
 ├ Claude
 └ ...

가 무한 증식하면서

WSL Memory 120GB+
Swap 폭증
IO 폭증

이 발생할 수 있습니다.