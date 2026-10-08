.PHONY: setup smoke api web agent

setup:
	uv venv --python 3.11 .venv
	uv pip install -r requirements.txt
	cd web && npm install

smoke:
	python scripts/smoke_test.py

api:
	uvicorn api.main:app --reload --port 8000

web:
	cd web && npm run dev

agent:
	python -m agent.agent "hello"
