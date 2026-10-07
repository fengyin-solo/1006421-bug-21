.PHONY: install frontend build verify

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

verify:
	cd frontend && npm run verify:prepare
