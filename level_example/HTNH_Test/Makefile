MAKEFLAGS += -s

LEVEL_BULID = node ../../main.js

all: HTNH_Test.BstBaked.meshes HTNH_Test.Objects.level.bin

HTNH_Test.BstBaked.meshes: HTNH_Test.obj
	$(LEVEL_BULID) --convert -i $< -o $@

HTNH_Test.Objects.level.bin: HTNH_Test.Objects.level.json
	$(LEVEL_BULID) --serialize -i $< -o $@
