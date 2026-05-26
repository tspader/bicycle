virt-install --connect qemu:///system \
    --name arch-installed --memory 4096 --vcpus 4 \
    --boot uefi --import \
    --disk path="$PWD/.cache/target.qcow2",bus=virtio,format=qcow2 \
    --network bridge=br0,model=virtio \
    --osinfo archlinux \
    --graphics spice --noautoconsole
